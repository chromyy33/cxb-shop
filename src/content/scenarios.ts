// The guided course: 4 modules → steps → scenarios.
// Every scenario has four parts: Scenario, Problem, What you do, Solution.

import type { DeepPartial } from '../sim/defaults';
import type { Env, ScriptStep, Sim } from '../sim/engine';
import { hourlyCost, p95 } from '../sim/engine';
import type { SimConfig, Snapshot, Totals } from '../sim/types';

export interface Goal {
  label: string;
  test: (sim: Sim) => boolean;
  value: (sim: Sim) => string;
}

export type ChartKey =
  | 'checkout'
  | 'threads'
  | 'payRps'
  | 'queue'
  | 'browse'
  | 'hitRate'
  | 'db'
  | 'outbox'
  | 'r429'
  | 'happiness'
  | 'myOrders';

export interface Scenario {
  id: string;
  module: number;
  step: number;
  stepTitle: string;
  title: string;
  nodes: string[];
  base: DeepPartial<SimConfig>;
  env?: Partial<Env>;
  setup?: (sim: Sim) => void;
  script: ScriptStep[];
  duration: number;
  charts: ChartKey[];
  stats: (keyof Totals)[];
  scenario: string;
  problem: { question: string; whatHappens: string };
  task: { brief: string; tools: string[]; goals: Goal[]; hints: string[] };
  solution: { summary: string; fix: DeepPartial<SimConfig>; costs: string; trap: string; signal: string };
}

export interface Module {
  n: number;
  title: string;
  blurb: string;
  color: string;
}

export const MODULES: Module[] = [
  { n: 1, title: 'The Shop Grows Up', blurb: 'One app or many, the front door, rate limits, and services that announce events.', color: 'var(--m1)' },
  { n: 2, title: 'Messages That Arrive', blurb: 'Save and announce without losing either, absorb a rush, and make repeats harmless.', color: 'var(--m2)' },
  { n: 3, title: 'When Things Fail', blurb: 'Timeouts, careful retries, circuit breakers, bulkheads, and what the customer sees.', color: 'var(--m3)' },
  { n: 4, title: 'Data Everywhere', blurb: 'Caching, an order across four services, and splitting reads from writes.', color: 'var(--m4)' },
];

// ───────── helpers
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const checkoutRate = (t: Totals) => {
  const all = t.checkoutOk + t.checkoutErrorPage + t.checkoutMessage + t.checkoutFrozen;
  return all ? t.checkoutOk / all : 1;
};
const browseRate = (t: Totals) => (t.browseOk + t.browseFrozen ? t.browseOk / (t.browseOk + t.browseFrozen) : 1);
const window = (sim: Sim, from: number, to: number) => sim.history.filter((s) => s.t > from && s.t <= to);
const sumOf = (xs: Snapshot[], f: (s: Snapshot) => number) => xs.reduce((a, s) => a + f(s), 0);
const windowRate = (sim: Sim, from: number, to: number) => {
  const w = window(sim, from, to);
  const ok = sumOf(w, (s) => s.checkoutOk);
  const bad = sumOf(w, (s) => s.checkoutFail);
  return ok + bad ? ok / (ok + bad) : 1;
};
const avgP95 = (sim: Sim, from: number, to: number) => {
  const w = window(sim, from, to).filter((s) => s.p95Checkout > 0);
  return w.length ? sumOf(w, (s) => s.p95Checkout) / w.length : 0;
};
const at = (sec: number, run: (sim: Sim) => void, label?: string): ScriptStep => ({ at: sec, run, label });

const g = {
  checkout: (min: number): Goal => ({
    label: `At least ${Math.round(min * 100)}% of checkouts succeed`,
    test: (s) => checkoutRate(s.totals) >= min,
    value: (s) => pct(checkoutRate(s.totals)),
  }),
  browse: (min: number): Goal => ({
    label: `At least ${Math.round(min * 100)}% of product pages load`,
    test: (s) => browseRate(s.totals) >= min,
    value: (s) => pct(browseRate(s.totals)),
  }),
  zero: (key: keyof Totals, label: string): Goal => ({
    label,
    test: (s) => (s.totals[key] as number) === 0,
    value: (s) => String(s.totals[key]),
  }),
  atMost: (key: keyof Totals, max: number, label: string): Goal => ({
    label,
    test: (s) => (s.totals[key] as number) <= max,
    value: (s) => String(Math.round(s.totals[key] as number)),
  }),
};

const SHOP = ['web', 'mobile', 'gateway', 'order', 'orderDb', 'payment', 'payco', 'inventory', 'recs', 'product', 'productDb', 'cache'];
const MSG = [...SHOP, 'outbox', 'broker', 'invWorkers', 'notifWorkers', 'email'];

// ───────── the course
export const SCENARIOS: Scenario[] = [
  // ═════════════ MODULE 1
  {
    id: 'm1-monolith',
    module: 1,
    step: 1,
    stepTitle: 'One app or many?',
    title: 'What if orders get 30 times busier?',
    nodes: ['web', 'mobile', 'monolith', 'order', 'product', 'orderDb', 'productDb', 'payment', 'payco', 'inventory', 'recs', 'broker', 'invWorkers', 'notifWorkers', 'email'],
    base: { architecture: 'monolith', monolithCopies: 1, gateway: false, cache: false, postOrder: 'events', dlq: false, browseRps: 30, checkoutRps: 12, myOrdersRps: 0 },
    setup: (sim) => {
      sim.paycoFree = new Array(200).fill(0);
    },
    script: [at(6, (s) => (s.cfg.checkoutRps = 400), 'A sneaker drop goes viral: orders jump from 12 to 400 a second.')],
    duration: 40,
    charts: ['checkout', 'threads'],
    stats: ['checkoutOk', 'checkoutFrozen', 'checkoutErrorPage'],
    scenario:
      'CXB Shop started as one application with one database: a modular monolith. Accounts, products, orders and emails each have their own module, but everything ships and runs as one program. Today a sneaker drop goes viral, and orders get 30 times busier than usual. Nothing else does.',
    problem: {
      question: 'Only orders got busier. What does it take to give orders more servers?',
      whatHappens:
        'Watch the monolith’s threads fill up. Checkouts start to wait and then time out. You can’t scale just the order module, because it’s part of one program. Every extra copy carries every other module too.',
    },
    task: {
      brief: 'Keep checkouts working through the rush without paying for copies of the parts that don’t need them. Budget: $400 an hour.',
      tools: ['split', 'scale'],
      goals: [
        g.checkout(0.97),
        { label: 'Servers cost no more than $400/hour', test: (s) => hourlyCost(s.cfg) <= 400, value: (s) => `$${hourlyCost(s.cfg)}/h` },
      ],
      hints: [
        'Adding monolith copies works, but look at the cost. Each copy runs the whole shop.',
        'Switch to separate services, then scale only the order service.',
      ],
    },
    solution: {
      summary: 'Pull the order module out into its own service and give only orders more servers. You split one piece, for one real reason, and leave the rest alone.',
      fix: { architecture: 'services', orderInstances: 3 },
      costs: 'The order service now talks to inventory and payment over a network. Calls can be slow, fail, or arrive twice. Most of the rest of this course deals with that.',
      trap: 'Splitting before you have a real reason. A small team with few users is usually better off with a well-built modular monolith.',
      signal: 'Watch thread use per service. Only split when one part needs scaling, security or releases of its own.',
    },
  },
  {
    id: 'm1-gateway',
    module: 1,
    step: 2,
    stepTitle: 'The front door',
    title: 'What if a service moves to a new address?',
    nodes: ['web', 'mobile', 'gateway', 'order', 'orderDb', 'product', 'cache', 'productDb', 'shipping'],
    base: { gateway: false, myOrdersRps: 14, checkoutRps: 6 },
    script: [
      at(10, (s) => (s.env.orderHistorySplit = true), 'The order team split order history into a new service with a new address.'),
    ],
    duration: 35,
    charts: ['myOrders', 'happiness'],
    stats: ['myOrdersOk', 'myOrdersFail'],
    scenario:
      'CXB Shop’s web and mobile apps call each service directly, using a list of addresses built into the apps. Today the order team splits “order history” into its own service with a new address. Web gets updated in minutes. Phones don’t: people take months to update their apps.',
    problem: {
      question: 'What happens to customers on older mobile app versions?',
      whatHappens:
        'Their “My orders” page keeps calling the old address and fails. The apps depend on how the shop is laid out inside, so every internal change becomes a client change.',
    },
    task: {
      brief: 'Make “My orders” work for every app version, even after the split.',
      tools: ['gateway'],
      goals: [
        {
          label: 'At least 95% of “My orders” views work',
          test: (s) => s.totals.myOrdersOk / Math.max(1, s.totals.myOrdersOk + s.totals.myOrdersFail) >= 0.95,
          value: (s) => pct(s.totals.myOrdersOk / Math.max(1, s.totals.myOrdersOk + s.totals.myOrdersFail)),
        },
      ],
      hints: ['What if the apps only ever knew one address?'],
    },
    solution: {
      summary: 'Put an API gateway in front of every service. Apps send everything to it, and it routes by path: /products → product service, /orders → order service. When the order team splits their service, they change one route in the gateway and the apps notice nothing.',
      fix: { gateway: true },
      costs: 'One extra network stop for every request, and the gateway becomes something that must not go down, so run several copies.',
      trap: 'Putting business logic in the gateway (prices, discounts, order checks). Then every feature needs a gateway change and you’ve built a new monolith in front of your services. Authorization (“can this customer see this order?”) stays in the service that owns the data.',
      signal: 'Count requests and errors per route at the gateway.',
    },
  },
  {
    id: 'm1-aggregate',
    module: 1,
    step: 2,
    stepTitle: 'The front door',
    title: 'What if a page needs three services on a weak signal?',
    nodes: ['mobile', 'gateway', 'order', 'payment', 'recs'],
    base: { accountRps: 12, accountMode: 'client', aggTimeoutMs: 0, checkoutRps: 0, browseRps: 0, myOrdersRps: 0 },
    script: [at(12, (s) => s.setDep('recs', 'slow'), 'The recommendation service is slow today (1.8s per answer).')],
    duration: 40,
    charts: ['happiness'],
    stats: ['accountOk', 'accountFail'],
    scenario:
      'The account page shows recent orders (order service), the saved card (payment service), and a row of “customers also bought” picks (recommendation service). On a phone with a weak signal, the app makes three separate trips to get them.',
    problem: {
      question: 'Three trips over a slow phone network. What could go wrong?',
      whatHappens:
        'Each trip can fail on its own, so the page breaks more often. And when recommendations get slow, the whole page waits for them.',
    },
    task: {
      brief: 'Make the account page load reliably and fast, even when recommendations are slow.',
      tools: ['aggregator'],
      goals: [
        {
          label: 'At least 95% of account pages load',
          test: (s) => s.totals.accountOk / Math.max(1, s.totals.accountOk + s.totals.accountFail) >= 0.95,
          value: (s) => pct(s.totals.accountOk / Math.max(1, s.totals.accountOk + s.totals.accountFail)),
        },
        {
          label: '95% of pages load in under 1.6s',
          test: (s) => p95(s.totals.accountLatency) <= 1600,
          value: (s) => `${(p95(s.totals.accountLatency) / 1000).toFixed(2)}s`,
        },
      ],
      hints: ['Let the gateway make the three calls on the fast inside network.', 'Should the page wait forever for picks the customer doesn’t need?'],
    },
    solution: {
      summary: 'Gateway aggregation: the phone sends one request, and the gateway calls all three services at the same time and builds one response. Give each part a time limit. If the picks are late, return the page without them.',
      fix: { accountMode: 'aggregate', aggTimeoutMs: 800 },
      costs: 'The page now depends on three services for one response, so the gateway needs per-call time limits.',
      trap: 'If web and mobile want very different shapes, one shared response serves neither well. That’s when a backend-for-frontend (BFF) per client earns its cost, but not before.',
      signal: 'Track how often each part of an aggregated page is left out.',
    },
  },
  {
    id: 'm1-ratelimit',
    module: 1,
    step: 3,
    stepTitle: 'Rate limiting',
    title: 'What if one client sends 3,000 requests a minute?',
    nodes: ['web', 'mobile', 'bot', 'gateway', 'product', 'productDb'],
    base: { cache: false, browseRps: 45, checkoutRps: 0, myOrdersRps: 0, rateLimit: 0, gatewayCopies: 1 },
    script: [at(6, (s) => (s.cfg.botRps = 50), 'A script starts copying the whole catalog: 3,000 requests a minute.')],
    duration: 40,
    charts: ['browse', 'db', 'r429'],
    stats: ['browseOk', 'browseFrozen', 'botPassed', 'rejected429'],
    scenario:
      'One morning, the product service slows down for everyone. The logs show one client sending 3,000 requests a minute. It’s a script copying the shop’s prices. Every request runs a database query.',
    problem: {
      question: 'One client is using most of the database. What happens to real customers?',
      whatHappens: 'They wait behind the bot. Product pages slow down and then time out.',
    },
    task: {
      brief: 'Protect real customers from the scraper. A person tapping through the app sends far fewer than 100 requests a minute.',
      tools: ['rateLimit'],
      goals: [g.browse(0.97), g.atMost('botPassed', 300, 'The bot gets fewer than 300 requests through')],
      hints: ['Cap how many requests each client can send in a minute.', 'A request turned away at the gateway costs the shop almost nothing.'],
    },
    solution: {
      summary: 'A rate limit at the gateway: each client may send, say, 100 requests a minute. Extra requests get HTTP 429 Too Many Requests, often with a Retry-After header. A token bucket allows short bursts (a page loading several things) but holds the average.',
      fix: { rateLimit: 100, rateLimitBurst: 20 },
      costs: 'You need to pick limits per kind of client (visitors, customers, partners) and stricter ones for costly endpoints like search and login.',
      trap: 'A simple counter that resets each minute lets a client send 100 in the last second and 100 in the next: 200 in two seconds. Token buckets avoid that.',
      signal: 'Count 429s per client. A sudden jump means a client is stuck retrying, or the limit is too low.',
    },
  },
  {
    id: 'm1-ratelimit-copies',
    module: 1,
    step: 3,
    stepTitle: 'Rate limiting',
    title: 'What if every gateway copy counts on its own?',
    nodes: ['web', 'mobile', 'bot', 'gateway', 'product', 'productDb'],
    base: { cache: false, browseRps: 45, checkoutRps: 0, myOrdersRps: 0, rateLimit: 300, rateLimitBurst: 20, rateLimitShared: false, gatewayCopies: 10 },
    script: [at(4, (s) => (s.cfg.botRps = 50), 'The scraper is back, and its requests are spread across all 10 gateway copies.')],
    duration: 40,
    charts: ['browse', 'db', 'r429'],
    stats: ['browseOk', 'browseFrozen', 'botPassed', 'rejected429'],
    scenario:
      'The shop now runs 10 copies of the gateway so the front door never goes down. The limit is 300 requests a minute per client. But each copy keeps its own count.',
    problem: {
      question: 'If each copy counts on its own, how many requests can one client really send?',
      whatHappens: 'Up to 10 × 300 = 3,000 a minute. The limit does nothing, and the database melts again.',
    },
    task: {
      brief: 'Make the limit hold across all gateway copies.',
      tools: ['sharedCounter', 'gatewayCopies', 'rateLimit'],
      goals: [g.browse(0.97), g.atMost('botPassed', 400, 'The bot gets fewer than 400 requests through')],
      hints: ['What if every copy read and updated one shared count?'],
    },
    solution: {
      summary: 'Keep the counts in a fast shared store that every gateway copy reads and updates. Under heavy load the count may be a little off, and most teams accept that, because a fast check matters more than a perfect one.',
      fix: { rateLimitShared: true },
      costs: 'One more fast store on the hot path of every request.',
      trap: 'Dropping to one gateway copy to make counting easy. Then if it fails, nobody can reach the shop.',
      signal: 'Compare 429s per client against the limit you set.',
    },
  },
  {
    id: 'm1-events',
    module: 1,
    step: 4,
    stepTitle: 'Services that announce events',
    title: 'What if the email company goes down?',
    nodes: [...MSG, 'shipping'],
    base: { postOrder: 'sync', checkoutRps: 12, cache: true },
    script: [
      at(8, (s) => s.setDep('email', 'down')),
      at(28, (s) => s.setDep('email', 'up')),
    ],
    duration: 45,
    charts: ['checkout', 'queue'],
    stats: ['checkoutOk', 'checkoutErrorPage', 'emailsSent'],
    scenario:
      'After an order is saved, the order service calls the notification service and waits, then shipping, then inventory. Each is a synchronous call: the caller stops and waits for the answer. Then the email company has a 20-second outage.',
    problem: {
      question: 'Should a customer be unable to buy shoes because a confirmation email can’t be sent right now?',
      whatHappens:
        'Watch checkouts fail the moment email goes down. The order service is tightly coupled to everything it calls: a failure anywhere reaches it.',
    },
    task: {
      brief: 'Keep orders working during the email outage. Emails may go out a little late.',
      tools: ['broker'],
      goals: [g.checkout(0.97)],
      hints: ['What if the order service just announced “an order was placed” and moved on?'],
    },
    solution: {
      summary: 'Publish an “order placed” event to a message broker. Inventory, notifications and shipping subscribe and react on their own time (publish/subscribe). During the outage the event waits at the broker, and the email goes out a few minutes late.',
      fix: { postOrder: 'events' },
      costs: 'Eventual consistency (stock is reserved a little later), duplicate delivery (events can arrive twice), and a broker to run. The screen should say “order received”, not “your shoes are reserved”.',
      trap: 'Assuming each event arrives exactly once. And there’s one more gap: what if the service crashes between saving the order and sending the event? Module 2 starts there.',
      signal: 'Watch each subscriber’s queue depth.',
    },
  },

  // ═════════════ MODULE 2
  {
    id: 'm2-outbox',
    module: 2,
    step: 1,
    stepTitle: 'Saving and announcing',
    title: 'What if the service crashes between saving and sending?',
    nodes: MSG,
    base: { postOrder: 'events', checkoutRps: 15 },
    env: { crashBetween: 0.03 },
    script: [
      at(12, (s) => s.setDep('broker', 'down')),
      at(20, (s) => s.setDep('broker', 'up')),
    ],
    duration: 40,
    charts: ['checkout', 'outbox'],
    stats: ['ordersPlaced', 'lostEvents', 'emailsSent'],
    scenario:
      'The order service does two writes for every order: it saves the order to its database, then publishes “order placed” to the broker. Today the order service sometimes crashes between those two steps, and the broker has an 8-second outage.',
    problem: {
      question: 'What if the order is saved but the event never leaves?',
      whatHappens:
        'The customer sees “order confirmed”. But inventory never reserves the shoes, no email goes out, and the warehouse never hears about it. This is the dual write problem: one action, two systems, nothing tying them together.',
    },
    task: {
      brief: 'Make sure no order is ever saved without its event.',
      tools: ['outbox'],
      goals: [g.zero('lostEvents', 'No order is saved without its event')],
      hints: ['The database already gives you one transaction you can trust.'],
    },
    solution: {
      summary: 'Transactional outbox: add an outbox table to the order database. In one transaction, insert the order and an “order placed” row. A separate relay reads the outbox and publishes each row, by polling every second or by tailing the database log (change data capture).',
      fix: { postOrder: 'outbox' },
      costs: 'A relay to run and watch, old rows to clean up, and at-least-once delivery: if the relay crashes after publishing but before marking a row sent, it publishes again.',
      trap: 'Forgetting that the process can crash between any two writes to two systems. Look for that in every design review.',
      signal: 'The age of the oldest unsent outbox row. If it keeps growing, the relay is stuck, even if it looks like it’s running.',
    },
  },
  {
    id: 'm2-queue',
    module: 2,
    step: 2,
    stepTitle: 'Absorbing a rush',
    title: 'What if orders arrive faster than inventory can handle?',
    nodes: MSG,
    base: { postOrder: 'sync', checkoutRps: 12, invWorkers: 1 },
    script: [
      at(8, (s) => (s.cfg.checkoutRps = 33), 'The biggest sale of the year starts: 2,000 orders a minute.'),
      at(28, (s) => (s.cfg.checkoutRps = 12), 'The rush is over.'),
    ],
    duration: 50,
    charts: ['checkout', 'queue'],
    stats: ['checkoutOk', 'checkoutErrorPage', 'invCrashes'],
    scenario:
      'Inventory can reserve about 1,000 orders a minute. The sale sends 2,000 a minute for a while. Right now the order service calls inventory directly for every order and waits.',
    problem: {
      question: 'What happens when every request goes straight to a service that can’t keep up?',
      whatHappens:
        'Requests pile up inside inventory, responses slow down, and it runs out of memory and crashes at the busiest moment of the year. Buying enough servers for the biggest spike is costly, and they sit idle most of the year.',
    },
    task: {
      brief: 'Get through the sale without inventory falling over. Reservations may happen a little later.',
      tools: ['broker'],
      goals: [g.checkout(0.95), g.zero('invCrashes', 'Inventory never crashes')],
      hints: ['Give the work a place to wait its turn.'],
    },
    solution: {
      summary: 'Queue-based load leveling: put a queue between the producer (order service) and the consumer (inventory). The queue takes work as fast as it arrives; inventory works through it at its own pace. The spike becomes a line, which shrinks after the rush.',
      fix: { postOrder: 'events' },
      costs: 'Work happens later, so the screen says “order received”. The broker must save messages to disk. And a queue only smooths bursts: it can’t fix a consumer that’s always too slow.',
      trap: 'Using a queue where the caller needs the answer right away.',
      signal: 'Queue depth should rise during the rush and fall after. If it only ever rises, the consumer is too slow on average.',
    },
  },
  {
    id: 'm2-consumers',
    module: 2,
    step: 3,
    stepTitle: 'Competing consumers',
    title: 'What if the line keeps getting longer?',
    nodes: MSG,
    base: { postOrder: 'events', invWorkers: 1, autoscale: false, checkoutRps: 12 },
    script: [
      at(6, (s) => (s.cfg.checkoutRps = 33), 'Sale traffic: 2,000 orders a minute.'),
      at(36, (s) => (s.cfg.checkoutRps = 12)),
    ],
    duration: 55,
    charts: ['queue', 'checkout'],
    stats: ['maxMsgAgeSec', 'dbOverloadSec'],
    scenario:
      'The queue saved inventory from crashing. But one inventory worker can only do 1,000 reservations a minute, so customers at the back of the line wait a long time before their shoes are reserved.',
    problem: {
      question: 'The queue protects inventory, but does it make inventory any faster?',
      whatHappens: 'No. Watch the oldest message get older and older. Thousands of messages wait for one copy of the service.',
    },
    task: {
      brief: 'Keep the oldest waiting reservation under 20 seconds, without overloading the inventory database (it handles about 12 workers).',
      tools: ['workers', 'autoscale'],
      goals: [
        { label: 'No reservation waits more than 20s', test: (s) => s.totals.maxMsgAgeSec <= 20, value: (s) => `${s.totals.maxMsgAgeSec.toFixed(0)}s` },
        g.zero('dbOverloadSec', 'Inventory database never overloaded'),
      ],
      hints: ['Run more copies reading the same queue.', 'If you autoscale, set a maximum.'],
    },
    solution: {
      summary: 'Competing consumers: run several workers on one queue. Each takes the next free message; the queue hides it from the others (visibility timeout) until the worker says “got it” (acknowledgement). If a worker crashes, the message comes back for another.',
      fix: { invWorkers: 5 },
      costs: 'Order isn’t kept anymore, and duplicates get more likely. A slow worker can let the hidden time run out while it’s still working.',
      trap: 'Autoscaling with no maximum. 50 workers overload the database behind them.',
      signal: 'Age of the oldest message, not just depth. Depth can look small while one message is stuck.',
    },
  },
  {
    id: 'm2-ordering',
    module: 2,
    step: 3,
    stepTitle: 'Competing consumers',
    title: 'What if the cancel arrives before the order?',
    nodes: MSG,
    base: { postOrder: 'events', invWorkers: 5, partitionKey: false, cancelShare: 0.15, checkoutRps: 15 },
    env: { slowTail: 0.2 },
    script: [],
    duration: 40,
    charts: ['queue'],
    stats: ['ghostReservations', 'dupRejected'],
    scenario:
      'Some customers place an order and cancel it a few seconds later. “Order placed” goes to one worker, “order cancelled” to another. Some reservations take longer than others.',
    problem: {
      question: 'What if the cancel worker finishes first?',
      whatHappens:
        'It tries to release shoes that aren’t reserved yet. Then the first worker reserves them for an order that was already cancelled. Those shoes are stuck.',
    },
    task: {
      brief: 'Make every cancel apply after its order, while different orders still run in parallel.',
      tools: ['partitionKey'],
      goals: [g.zero('ghostReservations', 'No shoes reserved for cancelled orders')],
      hints: ['Give each message a key, like the order ID.'],
    },
    solution: {
      summary: 'Partition by key: give each message the order ID as its key. All messages with the same key go to one worker at a time, in order. Different orders still run in parallel. Brokers call these partitions, message groups or sessions.',
      fix: { partitionKey: true },
      costs: 'You lose some speed: messages for one order wait for each other, and one stuck message can hold up other orders in the same partition.',
      trap: 'Assuming a queue keeps order. Many don’t, even with one worker.',
      signal: 'Count out-of-order events your handlers detect.',
    },
  },
  {
    id: 'm2-idem-api',
    module: 2,
    step: 4,
    stepTitle: 'Making repeats harmless',
    title: 'What if the app sends the same order twice?',
    nodes: SHOP,
    base: { serverIdempotency: false, signalDrop: 0.12, mobileShare: 0.7, checkoutRps: 14 },
    script: [],
    duration: 40,
    charts: ['checkout'],
    stats: ['duplicateOrders', 'doubleCharges', 'dupRejected'],
    scenario:
      'A customer taps “place order” on the train. The order is created, but the phone loses signal before the reply arrives. To the app, it failed, so it tries again.',
    problem: {
      question: 'If the order service treats the second request as new, what does the customer get?',
      whatHappens: 'Two orders, and two charges on their card. Watch the duplicate counters climb.',
    },
    task: {
      brief: 'One tap should mean one order, however many attempts the app makes.',
      tools: ['idemKey'],
      goals: [g.zero('duplicateOrders', 'No duplicate orders'), g.zero('doubleCharges', 'Nobody is charged twice')],
      hints: ['What if the app sent the same unique value with every attempt?'],
    },
    solution: {
      summary: 'Idempotency key: the app creates one unique key when the customer taps, and sends it on every retry (often in an Idempotency-Key header). The order service saves each key with its result. A key it has seen returns the saved result instead of creating a new order.',
      fix: { serverIdempotency: true },
      costs: 'A table of keys and results. Store final results only (a short-lived failure should be allowed to run again) and delete keys after a day or so.',
      trap: 'Creating a new key on each retry, which defeats the purpose.',
      signal: 'Count requests answered from a saved key. A small steady number is normal.',
    },
  },
  {
    id: 'm2-idem-consumer',
    module: 2,
    step: 4,
    stepTitle: 'Making repeats harmless',
    title: 'What if two workers get the same message?',
    nodes: MSG,
    base: { postOrder: 'outbox', invWorkers: 5, idempotentHandlers: false, uniqueConstraint: false, checkoutRps: 15 },
    env: { workerCrash: 0.03, relayCrash: 0.04, slowTail: 0.1 },
    script: [],
    duration: 45,
    charts: ['queue'],
    stats: ['doubleReserve', 'dupRejected'],
    scenario:
      'Duplicates now come from three places: the outbox relay can publish twice, a worker can crash after reserving but before acknowledging, and a slow worker can let the visibility timeout expire while another worker picks the same message up.',
    problem: {
      question: 'What does “reserve one pair” do when it runs twice?',
      whatHappens: 'It reserves two pairs. The stock count drifts away from reality, one duplicate at a time.',
    },
    task: {
      brief: 'Make reservation handle the same event twice with the same effect as once, including two copies arriving at the same instant.',
      tools: ['dedupe', 'uniqueConstraint'],
      goals: [g.zero('doubleReserve', 'No double reservations')],
      hints: [
        'Keep a table of event IDs you’ve processed.',
        'Two workers can both check the table before either has saved. Let the database decide.',
      ],
    },
    solution: {
      summary: 'Each event carries a unique ID. The worker inserts that ID into a processed-messages table inside the same transaction as the reservation, with a unique constraint. The first insert wins; the second fails, rolls back and skips the message.',
      fix: { idempotentHandlers: true, uniqueConstraint: true },
      costs: 'A table of processed IDs (keep them longer than a message might sit in the dead letter queue).',
      trap: 'Checking in memory or checking without a unique constraint: two workers on different machines race past the check together.',
      signal: 'Count rejected duplicates. A sudden rise means someone is retrying far too much, often a timeout set too short.',
    },
  },
  {
    id: 'm2-dlq',
    module: 2,
    step: 5,
    stepTitle: 'Messages that never succeed',
    title: 'What if a message fails every single time?',
    nodes: [...MSG, 'dlq'],
    base: { postOrder: 'outbox', invWorkers: 2, maxDeliveries: 0, dlq: false, checkoutRps: 14 },
    env: { poisonShare: 0.02 },
    script: [],
    duration: 45,
    charts: ['queue'],
    stats: ['poisonRetries', 'dlqIn', 'lostMessages'],
    scenario:
      'An old version of the mobile app sends a broken product ID now and then. Those order messages fail every time a worker touches them, and the queue keeps handing them out again.',
    problem: {
      question: 'What should happen to a message that will never succeed?',
      whatHappens:
        'If nothing stops it, workers waste time on it forever. If you just drop it after one failure, a real customer’s order disappears and nobody knows.',
    },
    task: {
      brief: 'Stop poison messages from looping forever without losing them. Then open the dead letter inbox, fix and replay them.',
      tools: ['giveUp', 'dlq'],
      goals: [
        g.atMost('poisonRetries', 150, 'Workers waste fewer than 150 attempts on poison messages'),
        g.zero('lostMessages', 'No order message is thrown away'),
      ],
      hints: ['Count deliveries, and stop after a few.', 'Move it somewhere a person will read it, rather than deleting it.'],
    },
    solution: {
      summary: 'Dead letter queue: after a set number of deliveries (say 5), the broker moves the message to a separate queue with its error attached. A person reads it, fixes the data or the bug, and replays it. It’s an inbox for a person, not a trash can.',
      fix: { maxDeliveries: 5, dlq: true },
      costs: 'Someone must own the inbox. Replayed messages may repeat partial work (idempotency again) and may break ordering for that order.',
      trap: 'A dead letter queue nobody watches only stores failures. Also check its retention: if it’s short, failed orders expire unread.',
      signal: 'Alert on any growth in the dead letter queue. Most of the time it should be zero.',
    },
  },

  // ═════════════ MODULE 3
  {
    id: 'm3-timeout',
    module: 3,
    step: 1,
    stepTitle: 'Timeouts',
    title: 'What if payment gets slow?',
    nodes: SHOP.concat(['shipping']),
    base: { pay: { timeoutMs: 0, retries: 0 }, checkoutRps: 20, myOrdersRps: 10 },
    script: [at(8, (s) => s.setDep('payment', 'slow'), 'Payment isn’t down. Every answer now takes 30 seconds.')],
    duration: 40,
    charts: ['threads', 'myOrders', 'checkout'],
    stats: ['checkoutOk', 'checkoutMessage', 'checkoutFrozen', 'myOrdersFail'],
    scenario:
      'The order service handles each request on a thread from a pool of 200. Usually payment answers in 300ms. This afternoon it gets slow: it doesn’t crash or return an error, it just takes 30 seconds.',
    problem: {
      question: 'Twenty checkouts a second, each holding a thread for 30 seconds. What happens to requests that don’t even touch payment?',
      whatHappens:
        'After about 10 seconds all 200 threads are waiting on payment. “My orders”, which never calls payment, can’t get a thread either. The web app backs up next. This is a cascading failure, and it started with a service that was only slow.',
    },
    task: {
      brief: 'Stop a slow payment service from taking the whole order service down, without breaking checkouts on a normal day.',
      tools: ['timeout'],
      goals: [
        {
          label: 'At least 95% of “My orders” views work',
          test: (s) => s.totals.myOrdersOk / Math.max(1, s.totals.myOrdersOk + s.totals.myOrdersFail) >= 0.95,
          value: (s) => pct(s.totals.myOrdersOk / Math.max(1, s.totals.myOrdersOk + s.totals.myOrdersFail)),
        },
        { label: 'Checkout works before payment slows (first 8s ≥ 95%)', test: (s) => windowRate(s, 1, 8) >= 0.95, value: (s) => pct(windowRate(s, 1, 8)) },
      ],
      hints: ['Set a limit on how long the order service waits.', 'A little above payment’s slowest normal answer. Too short and you cut off calls that would have worked.'],
    },
    solution: {
      summary: 'Give every call that leaves a service a timeout: other services, the database, the broker. Set it a little above the slowest normal answer (here about 2s). A slow payment service now costs 2 seconds per checkout, not the whole order service.',
      fix: { pay: { timeoutMs: 2000 } },
      costs: 'A call that timed out didn’t always fail: payment may have placed the hold a moment after you stopped waiting. That matters for retries.',
      trap: 'Many client libraries wait with no limit unless you set one. Also: a read timeout often measures the gap between pieces of data, not the whole answer, so set a total limit too.',
      signal: 'Timeout rate per service you call. It’s often the first number to move when something slows down.',
    },
  },
  {
    id: 'm3-retry-storm',
    module: 3,
    step: 2,
    stepTitle: 'Retries',
    title: 'What if everyone retries at once?',
    nodes: SHOP,
    base: { pay: { timeoutMs: 2000, retries: 5, backoffMs: 0, jitter: false, idempotencyKey: true }, checkoutRps: 25 },
    setup: (sim) => {
      sim.deps.payment.slow = 2500;
      sim.paycoFree = new Array(40).fill(0);
    },
    script: [
      at(10, (s) => s.setDep('payment', 'slow'), 'The payment company hiccups for 4 seconds.'),
      at(14, (s) => s.setDep('payment', 'up')),
    ],
    duration: 45,
    charts: ['payRps', 'checkout'],
    stats: ['payAttempts', 'peakPayRps', 'checkoutOk', 'checkoutMessage'],
    scenario:
      'Very often a failure lasts less than a second, and trying again a moment later works. So checkout retries failed payment calls, up to 5 times, immediately, in a loop. Then the payment company has a 4-second hiccup.',
    problem: {
      question: 'A thousand checkouts fail at once and all retry straight away. What does the payment company see?',
      whatHappens:
        'A second wave on top of the first, then a third. Watch payment calls per second spike long after the hiccup is over. This is a retry storm: it turns a short slowdown into an outage.',
    },
    task: {
      brief: 'Ride out the hiccup without flooding the payment company. Keep payment calls under 90 a second at the peak.',
      tools: ['retry'],
      goals: [
        g.checkout(0.85),
        { label: 'Payment calls never pass 90/second', test: (s) => s.totals.peakPayRps <= 90, value: (s) => `${s.totals.peakPayRps}/s` },
      ],
      hints: ['Wait before each retry, and double the wait every time.', 'If everyone waits exactly 1 second, they all come back together.', 'Cap the number of attempts.'],
    },
    solution: {
      summary: 'Three controls: exponential backoff (wait 0.5s, 1s, 2s…), jitter (a random wait between 0 and the backoff, so callers spread out), and a cap (2 retries). Only retry failures that might pass next time: timeouts, dropped connections, 503, and 429 after its Retry-After.',
      fix: { pay: { retries: 2, backoffMs: 500, jitter: true } },
      costs: 'Each retry adds waiting inside the customer’s time budget. 3 attempts × 2s + backoff must fit the 10s checkout budget.',
      trap: 'Retrying a 400 Bad Request or a declined card: those fail the same way every time.',
      signal: 'Compare retries with first attempts. If nearly every call needs a retry, retries are adding real load.',
    },
  },
  {
    id: 'm3-retry-layers',
    module: 3,
    step: 2,
    stepTitle: 'Retries',
    title: 'What if every layer retries?',
    nodes: SHOP,
    base: { pay: { timeoutMs: 2000, retries: 2, backoffMs: 200, jitter: true, idempotencyKey: false }, retryLayers: 3, checkoutRps: 12 },
    setup: (sim) => {
      sim.deps.payment.slow = 2300;
    },
    script: [
      at(8, (s) => s.setDep('payment', 'slow'), 'Payment answers in 2.3s, just over the 2s timeout.'),
      at(24, (s) => s.setDep('payment', 'up')),
    ],
    duration: 40,
    charts: ['payRps'],
    stats: ['payAttempts', 'doubleCharges', 'peakPayRps'],
    scenario:
      'The web app retries 3 times. For each of those, the order service retries 3 times, and for each of those the payment client retries 3 times. Payment answers just slower than the timeout, so every attempt “fails” on our side but really works at the payment company.',
    problem: {
      question: 'How many hold requests can one click send? And what happens when “failed” attempts actually worked?',
      whatHappens: 'Up to 3 × 3 × 3 = 27 calls. Each one that “timed out” may have placed a hold anyway, so customers get charged many times.',
    },
    task: {
      brief: 'Stop the multiplication and make repeated holds harmless.',
      tools: ['retryLayer', 'idemKey', 'retry'],
      goals: [g.zero('doubleCharges', 'Nobody is held/charged twice'), { label: 'Payment calls never pass 60/second', test: (s) => s.totals.peakPayRps <= 60, value: (s) => `${s.totals.peakPayRps}/s` }],
      hints: ['Pick one layer to do the retrying. The others pass the error straight back.', 'Send the same key on every attempt.'],
    },
    solution: {
      summary: 'Retry in one layer only. And a retry is only safe if the call is idempotent: the order service creates one idempotency key for this hold and sends it on every attempt, so the payment company returns the first result instead of holding the money again.',
      fix: { retryLayers: 1, pay: { idempotencyKey: true } },
      costs: 'Agreeing across teams which layer owns retries.',
      trap: '“Just retry it.” Ask four things: is the call idempotent? Which errors are retried? Is there backoff with jitter? Which layer owns the retry?',
      signal: 'Attempts per checkout. Anything near 27 means stacked retries.',
    },
  },
  {
    id: 'm3-breaker',
    module: 3,
    step: 3,
    stepTitle: 'Circuit breakers',
    title: 'What if payment is down for minutes?',
    nodes: SHOP,
    base: { pay: { timeoutMs: 2000, retries: 2, backoffMs: 500, jitter: true, idempotencyKey: true, breaker: false }, checkoutRps: 12 },
    script: [
      at(8, (s) => s.setDep('payment', 'down'), 'The payment service is down. It will be a while.'),
      at(30, (s) => s.setDep('payment', 'up')),
    ],
    duration: 45,
    charts: ['payRps', 'checkout', 'threads'],
    stats: ['payAttempts', 'payFastFails', 'checkoutMessage'],
    scenario:
      'Retries handle failures that last a second. But today payment is down for much longer. Every checkout still tries 3 times, waits about 7 seconds, and fails. Then the next customer does the same.',
    problem: {
      question: 'After thousands of failures, should the shop keep asking?',
      whatHappens:
        'Every call adds load to a service trying to restart, and every customer waits seconds for an error they could have had instantly.',
    },
    task: {
      brief: 'During the outage, fail fast and stop hammering payment. After it recovers, get back to normal on your own.',
      tools: ['breaker'],
      goals: [
        { label: 'During the outage, checkout answers in under 1s', test: (s) => avgP95(s, 12, 30) <= 1000, value: (s) => `${(avgP95(s, 12, 30) / 1000).toFixed(1)}s` },
        { label: 'Fewer than 150 calls hit payment while it’s down', test: (s) => payDuring(s) <= 150, value: (s) => String(payDuring(s)) },
        { label: 'After recovery, ≥ 90% of checkouts succeed', test: (s) => windowRate(s, 36, 45) >= 0.9, value: (s) => pct(windowRate(s, 36, 45)) },
      ],
      hints: ['Something in the caller that watches failures and stops calling for a while.', 'It has to let a few trial calls through to notice when payment is back.'],
    },
    solution: {
      summary: 'Circuit breaker, one per service you call. Closed: calls flow, results are counted. When failures pass a threshold (say half of the last 20), it opens: calls fail fast without being sent. After a wait it goes half-open and lets a few trial calls through. If they work it closes; if one fails it opens again.',
      fix: { pay: { breaker: true, breakerThreshold: 0.5, breakerOpenMs: 5000 } },
      costs: 'An open breaker turns every checkout into an instant error, so you must decide what the customer sees instead (next step).',
      trap: 'One breaker shared by every service (a broken recommendation service shouldn’t block payments), or a threshold with no minimum number of calls (2 failures at 3am shouldn’t trip it).',
      signal: 'Show each breaker’s state on a dashboard. Payment breaker open → wake someone up.',
    },
  },
  {
    id: 'm3-bulkhead',
    module: 3,
    step: 4,
    stepTitle: 'Bulkheads',
    title: 'What if a feature nobody needs gets slow?',
    nodes: SHOP,
    base: { checkoutRps: 120, browseRps: 20, recs: { timeoutMs: 2000, bulkhead: 0, fallback: 'omit' } },
    setup: (sim) => {
      sim.paycoFree = new Array(80).fill(0);
    },
    script: [at(8, (s) => s.setDep('recs', 'slow'), 'Recommendations got slow: 1.8s per answer, just inside the 2s timeout.')],
    duration: 50,
    charts: ['threads', 'checkout'],
    stats: ['checkoutOk', 'checkoutFrozen'],
    scenario:
      'During checkout the order service calls payment, inventory, and the recommendation service (“add some socks?”). All three share the order service’s 200 threads. One busy evening, recommendations slow to 1.8 seconds per call, still inside the 2-second timeout.',
    problem: {
      question: 'Every call succeeds and the breaker sees no failures. So why does checkout stop?',
      whatHappens:
        'At 100 checkouts a second, each holding a thread for almost 2 seconds, about 180 threads wait on recommendations. Payment and inventory are healthy, but checkout can’t get a thread. A feature nobody needs stopped the shop.',
    },
    task: {
      brief: 'Make sure a slow optional service can only use up its own share.',
      tools: ['bulkhead'],
      goals: [
        g.checkout(0.95),
        {
          label: 'The order service never runs out of threads',
          test: (s) => s.history.every((h) => h.orderThreads < h.orderThreadsMax),
          value: (s) => `peak ${Math.max(...s.history.map((h) => h.orderThreads))}/${s.history[0]?.orderThreadsMax ?? 0}`,
        },
      ],
      hints: ['A timeout limits how long calls wait. What limits how many wait at once?'],
    },
    solution: {
      summary: 'Bulkhead: give each dependency its own limited share, like the sealed sections of a ship’s hull. Recommendations get at most 20 calls at once; the 21st is turned away immediately and the page leaves suggestions out. Payment and inventory keep their own share.',
      fix: { recs: { bulkhead: 20 } },
      costs: 'Spare capacity. Threads set aside for payment sit unused while recommendations are busy.',
      trap: 'Forgetting connection pools: when a pool is empty, a call waits for a free connection, so set a short limit on that wait too.',
      signal: 'Count calls each bulkhead turned away. Ask of every dependency: if this gets slow, what else can it stop?',
    },
  },
  {
    id: 'm3-degrade',
    module: 3,
    step: 5,
    stepTitle: 'What the customer sees',
    title: 'What if a service fails while the customer waits?',
    nodes: SHOP,
    base: {
      checkoutRps: 12,
      recs: { timeoutMs: 500, fallback: 'none' },
      pay: { timeoutMs: 2000, breaker: true, fallback: 'pretend' },
    },
    script: [
      at(5, (s) => s.setDep('recs', 'down'), 'The recommendation service is down.'),
      at(18, (s) => s.setDep('payment', 'down'), 'Now payment is down too.'),
      at(32, (s) => s.setDep('payment', 'up')),
    ],
    duration: 45,
    charts: ['checkout', 'happiness'],
    stats: ['checkoutOk', 'checkoutErrorPage', 'checkoutMessage', 'unpaidOrders'],
    scenario:
      'Every pattern so far ends the same way: the timeout fires, retries run out, the breaker opens or the bulkhead says no. The code knows something failed. But a customer is still looking at the checkout page.',
    problem: {
      question: 'Without a plan, what does she see?',
      whatHappens:
        'An error page with a stack trace because socks can’t be suggested. Or worse: someone set payment to “pretend it worked”, so the shop ships shoes nobody paid for.',
    },
    task: {
      brief: 'Decide a fallback for each service: is it essential, optional, or replaceable?',
      tools: ['planB'],
      goals: [g.zero('unpaidOrders', 'No order ships without payment'), g.atMost('checkoutErrorPage', 0, 'No customer sees an error page')],
      hints: ['Recommendations are optional.', 'Payment is essential: no fallback can charge a card. Say so clearly.'],
    },
    solution: {
      summary: 'Graceful degradation: keep the most important parts working with fewer features. Optional (recommendations): leave them out. Replaceable (stock display): use a copy saved a minute ago. Essential (payment): a clear message: “We can’t take payments right now. Your cart is saved.”',
      fix: { recs: { fallback: 'omit' }, pay: { fallback: 'message' }, inv: { fallback: 'stale' } },
      costs: 'A fallback hides a problem from customers, so it must not hide it from your team.',
      trap: 'Pretending an essential call worked. (Accepting orders and charging later is a business decision made on purpose, with checks, not a fallback hidden in code.)',
      signal: 'Count how often each fallback runs, and test them by turning services off in a test environment.',
    },
  },
  {
    id: 'm3-observe',
    module: 3,
    step: 6,
    stepTitle: 'How would we know?',
    title: 'What if something breaks quietly?',
    nodes: MSG,
    base: { postOrder: 'outbox', alertOn: 'relayRunning', checkoutRps: 12 },
    script: [at(8, (s) => (s.env.relayStuck = true), 'Quietly, the relay lost its connection to the broker. Its process is still running.')],
    duration: 45,
    charts: ['outbox', 'queue'],
    stats: ['ordersPlaced', 'emailsSent'],
    scenario:
      'Every pattern adds code that runs when something goes wrong, and that code can break too. Today the outbox relay can’t reach the broker. The process is up, the health check is green, the page still loads.',
    problem: {
      question: 'Orders are being saved, but no events go out. How would your team find out?',
      whatHappens: 'With an alert on “is the relay running?”, they wouldn’t. It is running. It just delivers nothing.',
    },
    task: {
      brief: 'Pick the alert that catches lost work. When it fires, the on-call engineer fixes the relay.',
      tools: ['alarm'],
      goals: [
        { label: 'The on-call engineer is paged within 20s', test: (s) => s.totals.alertFiredAt >= 0 && s.totals.alertFiredAt <= 28000, value: (s) => (s.totals.alertFiredAt < 0 ? 'never' : `${((s.totals.alertFiredAt - 8000) / 1000).toFixed(0)}s after`) },
      ],
      hints: ['Alert on what customers feel and on signals that mean lost work.'],
    },
    solution: {
      summary: 'Observability: pick one signal per pattern. Outbox: age of the oldest unsent row. Queue: depth and oldest-message age. DLQ: any growth. Breakers: state. Fallbacks: how often they run. Pass one correlation ID through everything. Alert on customer pain and lost work; put the rest on a dashboard.',
      fix: { alertOn: 'outboxAge' },
      costs: 'Instrumenting each pattern as you add it.',
      trap: 'Alerting on whether a process is running. A relay that can’t reach the broker still looks alive.',
      signal: 'When you add a pattern, add its signal at the same time.',
    },
  },

  // ═════════════ MODULE 4
  {
    id: 'm4-cache',
    module: 4,
    step: 1,
    stepTitle: 'Caching',
    title: 'What if everyone opens the same page?',
    nodes: ['web', 'mobile', 'gateway', 'product', 'cache', 'productDb'],
    base: { cache: false, browseRps: 150, checkoutRps: 0, myOrdersRps: 0 },
    script: [],
    duration: 35,
    charts: ['browse', 'db', 'hitRate'],
    stats: ['browseOk', 'browseFrozen', 'dbQueries', 'cacheHits'],
    scenario:
      'A pair of running shoes goes on sale and thousands of people open the same page. Each visit runs the same database query and gets the same answer it got a second ago.',
    problem: {
      question: 'The answer hasn’t changed since the last request. Why ask the database again?',
      whatHappens: 'The database does the same work over and over, slows down, and every page that needs it slows down too.',
    },
    task: {
      brief: 'Keep product pages fast without buying a bigger database.',
      tools: ['cache'],
      goals: [
        g.browse(0.98),
        { label: '95% of pages load in under 400ms', test: (s) => p95(s.totals.browseLatency) <= 400, value: (s) => `${Math.round(p95(s.totals.browseLatency))}ms` },
      ],
      hints: ['Keep a fast copy and read it first.'],
    },
    solution: {
      summary: 'Cache-aside: the product service checks the cache first under a key (product:shoes-id). On a miss it reads the database, stores a copy, and returns. The next customer gets a hit. Only products people actually open fill the cache.',
      fix: { cache: true, cacheTtlSec: 60 },
      costs: 'One more system to run. If it goes down, all requests hit the database at once, so the database still needs room to cope for a while.',
      trap: 'Caching data that must be exact, or caching one user’s private data under a key others can read.',
      signal: 'Hit rate: most requests for the sale shoes should be hits.',
    },
  },
  {
    id: 'm4-invalidate',
    module: 4,
    step: 2,
    stepTitle: 'Keeping copies fresh',
    title: 'What if the price changes but the copy doesn’t?',
    nodes: ['web', 'mobile', 'admin', 'gateway', 'product', 'cache', 'productDb', 'order'],
    base: { cache: true, cacheTtlSec: 3600, invalidateOnWrite: false, adminInvalidates: false, checkoutPriceFromCache: true, browseRps: 60, checkoutRps: 10 },
    script: [
      at(8, (s) => s.changePrice('app'), 'The shop drops the running shoes from $90 to $70.'),
      at(24, (s) => s.changePrice('admin'), 'A manager lowers it again to $65 using the old admin tool.'),
    ],
    duration: 40,
    charts: ['browse', 'hitRate'],
    stats: ['staleReads', 'wrongPrice'],
    scenario:
      'The running shoes cost $90, and a copy sits in the cache. The shop drops the price to $70 for the sale. The product service updates the database. Later, a manager changes it again through the admin tool.',
    problem: {
      question: 'The database says $70. What does the next customer see?',
      whatHappens: '$90. The database is right and the copy is stale. Worse, checkout reads the price from the cache, so some customers pay the wrong amount.',
    },
    task: {
      brief: 'Keep customers seeing the current price, and make sure checkout always charges the right one.',
      tools: ['deleteOnWrite', 'priceFromCache', 'cache'],
      goals: [g.atMost('staleReads', 40, 'Fewer than 40 stale page views'), g.zero('wrongPrice', 'No one pays a wrong price')],
      hints: ['Update the database first, then delete the copy.', 'Every write path must do it, not just the main app.', 'A TTL limits how long a missed delete can do harm.'],
    },
    solution: {
      summary: 'Invalidate on every write: update the database, then delete the cached copy (delete rather than overwrite, because two updates can race). Every path that writes (app, admin tool, nightly import) must delete. Give entries a TTL as a second guard. Read the checkout price fresh from the database.',
      fix: { invalidateOnWrite: true, adminInvalidates: true, cacheTtlSec: 300, checkoutPriceFromCache: false },
      costs: 'TTL is a dial: too long and stale data lasts; too short and the database does the work again.',
      trap: 'Missing one write path, like the admin tool. Then only the TTL limits the damage.',
      signal: 'Sample cached values against the database and count mismatches.',
    },
  },
  {
    id: 'm4-stampede',
    module: 4,
    step: 3,
    stepTitle: 'Stampedes',
    title: 'What if a popular copy expires?',
    nodes: ['web', 'mobile', 'gateway', 'product', 'cache', 'productDb'],
    base: { cache: true, cacheTtlSec: 15, ttlJitter: false, coalescing: false, earlyRefresh: false, browseRps: 150, checkoutRps: 0, myOrdersRps: 0 },
    env: { heavyHotKey: true },
    setup: (sim) => sim.preloadCache(),
    script: [],
    duration: 45,
    charts: ['db', 'browse', 'hitRate'],
    stats: ['peakDbWaiting', 'dbQueries', 'browseFrozen'],
    scenario:
      'The sale loaded every product into the cache at once, each with the same 15-second TTL. The running shoes are the hottest item, and their page is an expensive query.',
    problem: {
      question: 'What happens in the second the hot entry expires? And when every entry expires in the same moment?',
      whatHappens:
        'Hundreds of requests miss together and all go to the database for the same row: a cache stampede (thundering herd). The database does the same expensive work hundreds of times before anyone refills the cache.',
    },
    task: {
      brief: 'Keep the database calm (fewer than 8 queries waiting at any moment) through every expiry.',
      tools: ['coalescing', 'ttlJitter', 'earlyRefresh', 'cache'],
      goals: [g.atMost('peakDbWaiting', 8, 'Never more than 8 queries waiting on the database'), g.browse(0.99)],
      hints: ['Only one request needs to rebuild a missing entry.', 'Don’t let thousands of entries expire in the same minute.'],
    },
    solution: {
      summary: 'Request coalescing: only one request rebuilds the entry (a short lock on that key that expires on its own), and the others wait for its result. Early refresh: rebuild a hot entry shortly before it expires. TTL jitter: add a small random amount to each TTL so expiries spread out.',
      fix: { coalescing: true, ttlJitter: true, earlyRefresh: true },
      costs: 'Locks on keys, and a little extra refresh work.',
      trap: 'Fixing the hot key but forgetting the mass expiry from a bulk preload.',
      signal: 'Database queries per second and misses per key during expiries.',
    },
  },
  {
    id: 'm4-saga',
    module: 4,
    step: 4,
    stepTitle: 'Sagas',
    title: 'What if payment fails after the shoes are reserved?',
    nodes: [...MSG, 'shipping'],
    base: { postOrder: 'outbox', sagaCompensate: false, sagaOrder: 'capture>reserve>book', checkoutRps: 15 },
    env: { saga: true, captureFail: 0.12, bookFail: 0.05, reserveFail: 0.03 },
    script: [],
    duration: 40,
    charts: ['checkout'],
    stats: ['sagaConfirmed', 'sagaCompensated', 'leakedStock', 'leakedDelivery', 'chargedNoShoes', 'refunds'],
    scenario:
      'One order needs four services to change their own databases: order (create), inventory (reserve a pair), shipping (book a delivery), payment (capture the held money). In the monolith one transaction covered it all. Now there are four databases.',
    problem: {
      question: 'Two steps committed, then the capture is declined. What undoes the first two?',
      whatHappens:
        'Nothing, unless you planned it. Pairs stay reserved for orders that died, deliveries stay booked, and when money is captured first, failures later mean refunds.',
    },
    task: {
      brief: 'Make every failed order clean up after itself, and avoid refunds.',
      tools: ['compensation', 'sagaOrder'],
      goals: [
        g.zero('leakedStock', 'No pairs stay reserved for failed orders'),
        g.zero('leakedDelivery', 'No deliveries stay booked for failed orders'),
        g.zero('chargedNoShoes', 'No one charged without shoes'),
        g.zero('refunds', 'No refunds needed'),
      ],
      hints: ['Write each step’s compensation when you build the step.', 'Put the step that’s hardest to reverse as late as you can.'],
    },
    solution: {
      summary: 'A saga: a series of local transactions, one per service, each committing on its own. If a step fails, compensations run for the steps already done: release the pair, cancel the delivery. Capture money last, because refunds are slow, cost fees and customers see them.',
      fix: { sagaCompensate: true, sagaOrder: 'reserve>book>capture' },
      costs: 'Other requests can see half-done work (the last pair looks reserved, then comes back). Compensations must be idempotent and safe to retry, and a person handles the ones that still fail.',
      trap: 'Adding compensations later, untested.',
      signal: 'Count sagas by state and alert on ones that sit too long.',
    },
  },
  {
    id: 'm4-saga-stuck',
    module: 4,
    step: 5,
    stepTitle: 'Who runs the saga?',
    title: 'What if a step never answers?',
    nodes: [...MSG, 'shipping'],
    base: { postOrder: 'outbox', sagaCompensate: true, sagaOrder: 'reserve>book>capture', sagaStepTimeout: false, checkoutRps: 12 },
    env: { saga: true, captureFail: 0.05 },
    script: [
      at(10, (s) => (s.env.shippingHang = true), 'The shipping service stops replying. Not an error, just silence.'),
      at(25, (s) => (s.env.shippingHang = false)),
    ],
    duration: 40,
    charts: ['checkout'],
    stats: ['sagaConfirmed', 'sagaCompensated', 'stuckSagas'],
    scenario:
      'The saga moves along by choreography: each service listens for the previous event, does its step and announces the result. For 15 seconds, shipping neither succeeds nor fails.',
    problem: {
      question: 'Which orders are stuck, and who would notice?',
      whatHappens: 'With no status and no timeouts, orders sit “pending” forever. Nobody is in charge, so nobody notices.',
    },
    task: {
      brief: 'No order should hang forever.',
      tools: ['stepTimeout'],
      goals: [g.zero('stuckSagas', 'No order stays stuck')],
      hints: ['Each step needs a timeout, plus an alert for sagas in one state too long.'],
    },
    solution: {
      summary: 'Give each saga step a timeout and make the order status show which step it reached (an intermediate state the app and support can both see). On timeout, compensate. Alert on sagas sitting in one state too long. Each step’s event still goes out through the outbox, and every handler stays idempotent.',
      fix: { sagaStepTimeout: true },
      costs: 'An orchestrator is one more component that must stay up and keep its state safe.',
      trap: 'A saga with no visible status and no timeouts.',
      signal: 'Sagas by state and age.',
    },
  },
  {
    id: 'm4-cqrs',
    module: 4,
    step: 6,
    stepTitle: 'Splitting reads from writes',
    title: 'What if one page needs three services?',
    nodes: ['web', 'mobile', 'gateway', 'order', 'orderDb', 'product', 'shipping', 'broker', 'readModel'],
    base: { myOrdersMode: 'callThree', readYourWrites: false, myOrdersRps: 30, checkoutRps: 10 },
    env: { projectionLagMs: 1500 },
    script: [at(8, (s) => s.setDep('shipping', 'slow'), 'Shipping is slow today (2.5s per answer).')],
    duration: 40,
    charts: ['myOrders', 'threads'],
    stats: ['myOrdersOk', 'myOrdersFail', 'missingOrder'],
    scenario:
      'The “My orders” page lists each order with product names (product service), payment status, and where the parcel is (shipping). Right now every view asks all three.',
    problem: {
      question: 'What happens to the page when shipping is slow? And what’s really wrong underneath?',
      whatHappens:
        'Every view waits on the slowest service. Underneath it’s a shape mismatch: the order tables are built for writing safely; the page wants one ready-made record per order.',
    },
    task: {
      brief: 'Make “My orders” fast, and make sure customers see the order they just placed.',
      tools: ['readModel', 'readYourWrites'],
      goals: [
        { label: '95% of “My orders” views in under 300ms', test: (s) => p95(s.totals.myOrdersLatency) <= 300 && s.totals.myOrdersFail === 0, value: (s) => `${Math.round(p95(s.totals.myOrdersLatency))}ms` },
        g.zero('missingOrder', 'No one asks “where’s my order?”'),
      ],
      hints: ['Give that one page its own model, kept current by events.', 'The read model lags a little behind the write.'],
    },
    solution: {
      summary: 'CQRS: commands (place order) go to the write model; queries (show my orders) go to a read model shaped for that screen. A projection listens to “order placed”, “payment captured” and “parcel shipped” and keeps one record per order current. Show the just-placed order from the reply the app already has (reading your own writes).',
      fix: { myOrdersMode: 'readModel', readYourWrites: true },
      costs: 'The read model is eventually consistent, and sometimes needs rebuilding (replay events, or rebuild from the write side).',
      trap: 'Using CQRS everywhere. Name the one slow screen and split only that.',
      signal: 'Projection lag: time from event to read model update.',
    },
  },
];

function payDuring(sim: Sim) {
  return sumOf(window(sim, 9, 30), (s) => s.payRps);
}

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
export const scenariosOf = (m: number) => SCENARIOS.filter((s) => s.module === m);
