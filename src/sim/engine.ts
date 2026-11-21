// Discrete-event simulation of the CXB Shop shoe shop.
// Every request, call, retry, event and queue message is a timed event.

import type {
  CallPolicy,
  DepStatus,
  DlqMessage,
  LogLine,
  Packet,
  PacketKind,
  SimConfig,
  Snapshot,
  Totals,
  TrackStage,
  Tracked,
} from './types';

// ───────────────────────── helpers

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ev {
  t: number;
  seq: number;
  fn: () => void;
}

class Heap {
  private a: Ev[] = [];
  get size() {
    return this.a.length;
  }
  peek() {
    return this.a[0];
  }
  push(e: Ev) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): Ev | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
const less = (x: Ev, y: Ev) => x.t < y.t || (x.t === y.t && x.seq < y.seq);

interface Waiter {
  cb: () => void;
  dead: boolean;
}

/** A fixed set of threads / connections. Callers queue when it is full. */
class Pool {
  size: number;
  used = 0;
  private q: Waiter[] = [];
  live = 0;
  private sim: Sim;
  constructor(sim: Sim, size: number) {
    this.sim = sim;
    this.size = size;
  }
  acquire(cb: () => void): Waiter {
    const w: Waiter = { cb, dead: false };
    if (this.used < this.size) {
      this.used++;
      cb();
    } else {
      this.q.push(w);
      this.live++;
    }
    return w;
  }
  cancel(w: Waiter) {
    if (!w.dead) {
      w.dead = true;
      this.live--;
    }
  }
  release() {
    while (this.q.length) {
      const w = this.q.shift()!;
      if (w.dead) continue;
      w.dead = true;
      this.live--;
      this.sim.after(0, w.cb);
      return;
    }
    this.used = Math.max(0, this.used - 1);
    // the pool may have grown: start more waiters
    while (this.used < this.size && this.q.length) {
      const w = this.q.shift()!;
      if (w.dead) continue;
      w.dead = true;
      this.live--;
      this.used++;
      this.sim.after(0, w.cb);
    }
  }
  get waiting() {
    return this.live;
  }
}

// ───────────────────────── environment the scenario controls (not the player)

export interface Env {
  crashBetween: number; // chance the order service crashes between save and publish
  relayCrash: number; // chance the relay crashes before marking a row sent
  relayStuck: boolean; // relay runs but can't reach the broker
  workerCrash: number; // chance a worker crashes after work, before ack
  slowTail: number; // chance a queue message takes much longer
  poisonShare: number; // share of messages with broken data
  captureFail: number;
  bookFail: number;
  reserveFail: number;
  shippingHang: boolean;
  saga: boolean;
  projectionLagMs: number;
  orderHistorySplit: boolean; // order team moved order history to a new address
  heavyHotKey: boolean; // hot product page query is expensive
  oldAppBadIds: boolean;
}

const defaultEnv = (): Env => ({
  crashBetween: 0,
  relayCrash: 0,
  relayStuck: false,
  workerCrash: 0,
  slowTail: 0.05,
  poisonShare: 0,
  captureFail: 0,
  bookFail: 0,
  reserveFail: 0,
  shippingHang: false,
  saga: false,
  projectionLagMs: 300,
  orderHistorySplit: false,
  heavyHotKey: false,
  oldAppBadIds: false,
});

export type DepName = 'payment' | 'inventory' | 'recs' | 'email' | 'shipping' | 'broker' | 'invReserve';

interface DepState {
  status: DepStatus;
  base: number;
  slow: number;
}

interface Breaker {
  state: 'closed' | 'open' | 'half';
  window: boolean[];
  openedAt: number;
  trials: number;
  epoch: number; // bumps on every state change; late results from older states are ignored
}

interface Msg {
  id: number;
  orderId: number;
  kind: 'placed' | 'cancel';
  deliveries: number;
  visibleAt: number;
  poison: boolean;
  taken: boolean;
  createdAt: number;
}

interface Queue {
  name: 'inv' | 'notif';
  msgs: Msg[];
  busy: number;
  busyOrders: Map<number, number>;
}

export interface ScriptStep {
  at: number; // seconds
  label?: string;
  run: (sim: Sim) => void;
}

const DEP_NODE: Record<DepName, string> = {
  payment: 'payment',
  inventory: 'inventory',
  recs: 'recs',
  email: 'email',
  shipping: 'shipping',
  broker: 'broker',
  invReserve: 'inventory',
};

const emptyTotals = (): Totals => ({
  checkoutOk: 0,
  checkoutErrorPage: 0,
  checkoutMessage: 0,
  checkoutFrozen: 0,
  browseOk: 0,
  browseFrozen: 0,
  myOrdersOk: 0,
  myOrdersFail: 0,
  missingOrder: 0,
  accountOk: 0,
  accountFail: 0,
  botPassed: 0,
  rejected429: 0,
  payAttempts: 0,
  payFastFails: 0,
  doubleCharges: 0,
  duplicateOrders: 0,
  unpaidOrders: 0,
  lostEvents: 0,
  doubleReserve: 0,
  ghostReservations: 0,
  dupRejected: 0,
  poisonRetries: 0,
  lostMessages: 0,
  dlqIn: 0,
  staleReads: 0,
  wrongPrice: 0,
  cacheHits: 0,
  cacheMisses: 0,
  dbQueries: 0,
  sagaConfirmed: 0,
  sagaCompensated: 0,
  leakedStock: 0,
  leakedDelivery: 0,
  chargedNoShoes: 0,
  refunds: 0,
  stuckSagas: 0,
  emailsSent: 0,
  ordersPlaced: 0,
  revenue: 0,
  cost: 0,
  alertFiredAt: -1,
  peakPayRps: 0,
  peakDbWaiting: 0,
  maxMsgAgeSec: 0,
  dbOverloadSec: 0,
  invCrashes: 0,
  checkoutLatency: [],
  browseLatency: [],
  myOrdersLatency: [],
  accountLatency: [],
});


const PATIENCE = { checkout: 10000, browse: 4000, myOrders: 4000 };
const PRODUCTS = 200;
const INV_DB_LIMIT = 12;
const VISIBILITY_MS = 2500;

export const COST_PER_HOUR = {
  monolithCopy: 220,
  orderInstance: 60,
  productInstance: 40,
  gatewayCopy: 25,
  cache: 50,
  broker: 40,
  relay: 10,
  worker: 8,
  readModel: 30,
  dlq: 5,
};

export function hourlyCost(c: SimConfig, workers = c.invWorkers): number {
  let cost = 0;
  if (c.architecture === 'monolith') cost += c.monolithCopies * COST_PER_HOUR.monolithCopy;
  else cost += c.orderInstances * COST_PER_HOUR.orderInstance + c.productInstances * COST_PER_HOUR.productInstance;
  if (c.gateway) cost += c.gatewayCopies * COST_PER_HOUR.gatewayCopy;
  if (c.cache) cost += COST_PER_HOUR.cache;
  if (c.postOrder !== 'sync') cost += COST_PER_HOUR.broker + workers * COST_PER_HOUR.worker;
  if (c.postOrder === 'outbox') cost += COST_PER_HOUR.relay;
  if (c.myOrdersMode === 'readModel') cost += COST_PER_HOUR.readModel;
  if (c.dlq) cost += COST_PER_HOUR.dlq;
  return cost;
}

export const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};

// ───────────────────────── the simulation

export class Sim {
  cfg: SimConfig;
  env: Env = defaultEnv();
  now = 0;
  private heap = new Heap();
  private seq = 0;
  rand: () => number;

  totals: Totals = emptyTotals();
  history: Snapshot[] = [];
  packets: Packet[] = [];
  log: LogLine[] = [];
  dlq: DlqMessage[] = [];
  packetBudget = 1;

  deps: Record<DepName, DepState> = {
    payment: { status: 'up', base: 300, slow: 30000 },
    inventory: { status: 'up', base: 40, slow: 3000 },
    recs: { status: 'up', base: 80, slow: 1800 },
    email: { status: 'up', base: 200, slow: 5000 },
    shipping: { status: 'up', base: 60, slow: 2500 },
    broker: { status: 'up', base: 5, slow: 500 },
    invReserve: { status: 'up', base: 60, slow: 3000 },
  };
  breakers: Record<string, Breaker> = {};
  inflight: Record<string, number> = {};

  orderPool: Pool;
  productPool: Pool;
  dbPool: Pool;
  readsPool: Pool;

  // payments
  /** The payment company: a fixed number of workers, each busy until a time. */
  paycoFree: number[] = new Array(24).fill(0);
  private holdsByOrder = new Map<number, number>();
  private chargesByIntent = new Map<number, number>();
  private intents = new Map<number, 'processing' | 'done'>();

  // messaging
  outbox: { orderId: number; eventId: number; kind: 'placed' | 'cancel'; createdAt: number }[] = [];
  queues: Record<'inv' | 'notif', Queue> = {
    inv: { name: 'inv', msgs: [], busy: 0, busyOrders: new Map() },
    notif: { name: 'notif', msgs: [], busy: 0, busyOrders: new Map() },
  };
  workers = 1;
  private processed = new Set<number>();
  private inProgress = new Map<number, number>();
  private reserved = new Set<number>();
  private cancelledEarly = new Set<number>();
  private invLoad: number[] = [];
  private invOverSec = 0;

  // cache
  cache = new Map<number, { version: number; expiresAt: number }>();
  private rebuilding = new Map<number, (() => void)[]>();
  dbVersion: number[] = new Array(PRODUCTS).fill(0);

  // rate limit
  private bucket = { tokens: 20, last: 0 };

  // saga
  sagasRunning = 0;

  // per-second counters
  private sec = this.freshSec();
  private nextId = 1;
  private happiness = 100;
  relayRunning = true;
  script: ScriptStep[] = [];
  private scriptIdx = 0;
  duration = Infinity;

  constructor(cfg: SimConfig, seed = 7) {
    this.cfg = cfg;
    this.rand = mulberry32(seed);
    this.orderPool = new Pool(this, 1);
    this.productPool = new Pool(this, 1);
    this.dbPool = new Pool(this, 10);
    this.readsPool = new Pool(this, 200);
    this.applySizes();
    this.bucket.tokens = cfg.rateLimitBurst;
    for (const k of ['browse', 'checkout', 'myOrders', 'account', 'bot'] as const) this.arrivals(k);
    this.every(1000, () => this.tickSecond());
    this.every(100, () => this.relayTick());
  }

  // ── scheduling
  after(ms: number, fn: () => void) {
    this.heap.push({ t: this.now + Math.max(0, ms), seq: this.seq++, fn });
  }
  private every(ms: number, fn: () => void) {
    const loop = () => {
      fn();
      this.after(ms, loop);
    };
    this.after(ms, loop);
  }

  advance(ms: number) {
    const target = Math.min(this.now + ms, this.duration * 1000);
    for (;;) {
      const top = this.heap.peek();
      if (!top || top.t > target) break;
      this.heap.pop();
      this.now = top.t;
      top.fn();
    }
    this.now = target;
    this.runScript();
  }

  get done() {
    return this.now >= this.duration * 1000;
  }

  setScript(steps: ScriptStep[], durationSec: number) {
    this.script = [...steps].sort((a, b) => a.at - b.at);
    this.scriptIdx = 0;
    this.duration = durationSec;
    this.runScript();
  }

  private runScript() {
    while (this.scriptIdx < this.script.length && this.script[this.scriptIdx].at * 1000 <= this.now) {
      const s = this.script[this.scriptIdx++];
      s.run(this);
      if (s.label) this.say('warn', s.label);
    }
  }

  setConfig(cfg: SimConfig) {
    this.cfg = cfg;
    this.applySizes();
  }

  private applySizes() {
    const c = this.cfg;
    if (c.architecture === 'monolith') {
      const size = c.monolithCopies * 100;
      this.orderPool.size = size;
      this.productPool = this.orderPool;
    } else {
      this.orderPool.size = c.orderInstances * c.orderThreads;
      if (this.productPool === this.orderPool) this.productPool = new Pool(this, 1);
      this.productPool.size = c.productInstances * c.productThreads;
    }
    if (!c.autoscale) this.workers = c.invWorkers;
    for (const q of Object.values(this.queues)) this.pump(q);
  }

  setDep(dep: DepName, status: DepStatus) {
    this.deps[dep].status = status;
    const names: Record<DepName, string> = {
      payment: 'Payment',
      inventory: 'Inventory',
      recs: 'Recommendations',
      email: 'Email provider',
      shipping: 'Shipping',
      broker: 'Message broker',
      invReserve: 'Inventory',
    };
    const what = { up: 'is healthy again', slow: 'got slow', down: 'is down', flaky: 'is failing every call' }[status];
    this.say(status === 'up' ? 'good' : 'bad', `${names[dep]} ${what}.`);
  }

  say(level: LogLine['level'], text: string) {
    this.log.push({ t: this.now, level, text });
    if (this.log.length > 120) this.log.splice(0, this.log.length - 120);
  }

  private emit(from: string, to: string, kind: PacketKind, dur: number) {
    if (this.rand() > this.packetBudget) return;
    if (this.packets.length > 700) return;
    this.packets.push({ from, to, kind, t0: this.now, t1: this.now + Math.max(120, Math.min(dur, 900)) });
  }

  private exp(mean: number) {
    return -Math.log(1 - this.rand()) * mean;
  }
  private jitterLat(base: number) {
    return base * (0.7 + this.rand() * 0.6);
  }
  private id() {
    return this.nextId++;
  }

  private freshSec() {
    return {
      cOk: 0,
      cFail: 0,
      bOk: 0,
      bFail: 0,
      cLat: [] as number[],
      bLat: [] as number[],
      mLat: [] as number[],
      pay: 0,
      r429: 0,
      hits: 0,
      misses: 0,
      happy: 0,
      unhappy: 0,
    };
  }

  // ── traffic
  private arrivals(kind: 'browse' | 'checkout' | 'myOrders' | 'account' | 'bot') {
    const rateOf = () =>
      ({
        browse: this.cfg.browseRps,
        checkout: this.cfg.checkoutRps,
        myOrders: this.cfg.myOrdersRps,
        account: this.cfg.accountRps,
        bot: this.cfg.botRps,
      })[kind];
    const next = () => {
      const r = rateOf();
      if (r <= 0) {
        this.after(250, next);
        return;
      }
      this.after(this.exp(1000 / r), () => {
        if (rateOf() > 0) {
          if (kind === 'browse') this.browse(false);
          else if (kind === 'bot') this.browse(true);
          else if (kind === 'checkout') this.checkout();
          else if (kind === 'myOrders') this.myOrders();
          else this.account();
        }
        next();
      });
    };
    next();
  }

  private client(): 'web' | 'mobile' {
    return this.rand() < this.cfg.mobileShare ? 'mobile' : 'web';
  }

  private entry(client: string, target: string, kind: PacketKind) {
    if (this.cfg.gateway) {
      this.emit(client, 'gateway', kind, 250);
      this.emit('gateway', target, kind, 250);
    } else this.emit(client, target, kind, 400);
  }

  private svc(name: 'order' | 'product') {
    return this.cfg.architecture === 'monolith' ? 'monolith' : name;
  }

  // ── rate limiting (token bucket for the scraper bot)
  private allowBot(): boolean {
    const c = this.cfg;
    if (!c.gateway || c.rateLimit <= 0) return true;
    const copies = c.rateLimitShared ? 1 : c.gatewayCopies;
    const refillPerMs = (c.rateLimit / 60000) * copies;
    const burst = c.rateLimitBurst * copies;
    const b = this.bucket;
    b.tokens = Math.min(burst, b.tokens + (this.now - b.last) * refillPerMs);
    b.last = this.now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  // ── browse: product page (customers and the scraper bot)
  private browse(isBot: boolean) {
    const start = this.now;
    const key = isBot ? Math.floor(this.rand() * PRODUCTS) : this.rand() < 0.4 ? 0 : 1 + Math.floor(this.rand() * 49);
    const from = isBot ? 'bot' : this.client();
    if (isBot && !this.allowBot()) {
      this.totals.rejected429++;
      this.sec.r429++;
      this.emit('bot', 'gateway', 'reject', 200);
      return;
    }
    this.entry(from, this.svc('product'), isBot ? 'bot' : 'browse');
    let finished = false;
    const giveUp = () => {
      if (finished) return;
      finished = true;
      if (!isBot) {
        this.totals.browseFrozen++;
        this.sec.bFail++;
        this.sec.unhappy++;
      }
    };
    const w = this.productPool.acquire(() => {
      const respond = () => {
        this.productPool.release();
        if (finished) return;
        finished = true;
        const lat = this.now - start;
        if (isBot) {
          this.totals.botPassed++;
          return;
        }
        this.totals.browseOk++;
        this.totals.browseLatency.push(lat);
        this.sec.bOk++;
        this.sec.bLat.push(lat);
        this.sec.happy++;
      };
      if (this.cfg.cache) this.cacheGet(key, !isBot, () => this.after(15, respond));
      else this.dbQuery(key, () => this.after(15, respond));
    });
    this.after(PATIENCE.browse, () => {
      if (!finished) {
        this.productPool.cancel(w);
        giveUp();
      }
    });
  }

  private dbQuery(key: number, done: () => void) {
    this.totals.dbQueries++;
    const heavy = key === 0 && this.env.heavyHotKey;
    this.emit(this.svc('product'), 'productDb', 'db', 300);
    this.dbPool.acquire(() => {
      // a crowded database gets slower for everyone (locks, disk, CPU)
      const contention = 1 + Math.min(0.5, this.dbPool.waiting / 40);
      this.after(this.jitterLat(heavy ? 400 : 120) * contention, () => {
        this.dbPool.release();
        done();
      });
    });
  }

  private ttlMs() {
    const base = this.cfg.cacheTtlSec * 1000;
    return this.cfg.ttlJitter ? base * (0.85 + this.rand() * 0.3) : base;
  }

  private rebuild(key: number, cb?: () => void) {
    const waiting = this.rebuilding.get(key);
    if (waiting) {
      if (cb) waiting.push(cb);
      return;
    }
    const list = cb ? [cb] : [];
    if (this.cfg.coalescing) this.rebuilding.set(key, list);
    this.dbQuery(key, () => {
      this.cache.set(key, { version: this.dbVersion[key], expiresAt: this.now + this.ttlMs() });
      this.emit('productDb', 'cache', 'cache', 250);
      const cbs = this.rebuilding.get(key) ?? list;
      this.rebuilding.delete(key);
      for (const f of cbs) f();
    });
  }

  private cacheGet(key: number, customer: boolean, done: () => void) {
    const e = this.cache.get(key);
    this.emit(this.svc('product'), 'cache', 'cache', 150);
    if (e && e.expiresAt > this.now) {
      this.totals.cacheHits++;
      this.sec.hits++;
      if (customer && e.version < this.dbVersion[key]) this.totals.staleReads++;
      if (this.cfg.earlyRefresh && e.expiresAt - this.now < this.cfg.cacheTtlSec * 150 && !this.rebuilding.has(key)) {
        if (this.cfg.coalescing) this.rebuild(key);
      }
      this.after(2, done);
      return;
    }
    this.totals.cacheMisses++;
    this.sec.misses++;
    if (this.cfg.coalescing) this.rebuild(key, done);
    else {
      this.dbQuery(key, () => {
        this.cache.set(key, { version: this.dbVersion[key], expiresAt: this.now + this.ttlMs() });
        done();
      });
    }
  }

  /** Admin or app changes a price. */
  changePrice(path: 'app' | 'admin') {
    this.dbVersion[0]++;
    this.emit(path === 'app' ? 'product' : 'admin', 'productDb', 'db', 500);
    const invalidates = path === 'app' ? this.cfg.invalidateOnWrite : this.cfg.adminInvalidates;
    if (this.cfg.cache && invalidates) {
      this.cache.delete(0);
      this.say('info', `Price changed from the ${path === 'app' ? 'shop app' : 'admin tool'}. Cached copy deleted.`);
    } else if (this.cfg.cache) {
      this.say('warn', `Price changed from the ${path === 'app' ? 'shop app' : 'admin tool'}, but the cached copy was kept.`);
    }
  }

  /** The sale loads every product into the cache at once. */
  preloadCache() {
    for (let k = 0; k < PRODUCTS; k++) this.cache.set(k, { version: this.dbVersion[k], expiresAt: this.now + this.ttlMs() });
  }

  // ── calls between services, with timeout / retry / breaker / bulkhead

  private breaker(dep: string): Breaker {
    return (this.breakers[dep] ??= { state: 'closed', window: [], openedAt: 0, trials: 0, epoch: 0 });
  }

  private record(dep: string, policy: CallPolicy, ok: boolean, epoch: number) {
    if (!policy.breaker) return;
    const b = this.breaker(dep);
    if (epoch !== b.epoch) return;
    if (b.state === 'half') {
      b.trials = Math.max(0, b.trials - 1);
      b.epoch++;
      b.window = [];
      if (!ok) {
        b.state = 'open';
        b.openedAt = this.now;
        this.say('bad', `Circuit breaker for ${dep} opened again after a failed trial call.`);
      } else {
        b.state = 'closed';
        this.say('good', `Circuit breaker for ${dep} closed. Calls flow again.`);
      }
      return;
    }
    b.window.push(ok);
    if (b.window.length > 20) b.window.shift();
    const fails = b.window.filter((x) => !x).length;
    if (b.state === 'closed' && b.window.length >= 10 && fails / b.window.length > policy.breakerThreshold) {
      b.state = 'open';
      b.openedAt = this.now;
      b.epoch++;
      this.say('warn', `Circuit breaker for ${dep} opened. Calls now fail fast.`);
    }
  }

  private sample(dep: DepName): { lat: number; ok: boolean } {
    const d = this.deps[dep];
    if (dep === 'payment') {
      if (d.status === 'down') return { lat: Infinity, ok: false };
      if (d.status === 'flaky') return { lat: 40, ok: false };
      // queue at the payment company: work waits for a free worker, even if the caller gave up
      const service = this.jitterLat(d.status === 'slow' ? d.slow : d.base);
      const f = this.paycoFree;
      let bi = 0;
      for (let i = 1; i < f.length; i++) if (f[i] < f[bi]) bi = i;
      const startAt = Math.max(this.now, f[bi]);
      f[bi] = startAt + service;
      return { lat: f[bi] - this.now, ok: true };
    }
    if (dep === 'invReserve') {
      if (d.status === 'down') return { lat: 30, ok: false };
      const rate = this.invLoad.length;
      const u = rate / 17;
      return { lat: this.jitterLat(d.base) * Math.max(1, u ** 3), ok: true };
    }
    if (d.status === 'down') return { lat: Infinity, ok: false };
    if (d.status === 'flaky') return { lat: 40, ok: false };
    return { lat: this.jitterLat(d.status === 'slow' ? d.slow : d.base), ok: true };
  }

  /**
   * Make a call to a dependency the way the policy says.
   * `effect` runs at the dependency when the work really happens — even if the caller stopped waiting.
   */
  private call(
    dep: DepName,
    policy: CallPolicy,
    caller: string,
    done: (ok: boolean, why: string) => void,
    effect?: (attempt: number) => void,
  ) {
    const layers = dep === 'payment' ? this.cfg.retryLayers : 1;
    const maxAttempts = Math.pow(policy.retries + 1, layers);
    const attempt = (n: number) => {
      const b = this.breaker(dep);
      if (policy.breaker) {
        if (b.state === 'open' && this.now - b.openedAt >= policy.breakerOpenMs) {
          b.state = 'half';
          b.trials = 0;
          b.epoch++;
          this.say('info', `Circuit breaker for ${dep} is half-open: letting a few trial calls through.`);
        }
        if (b.state === 'open' || (b.state === 'half' && b.trials >= 3)) {
          if (dep === 'payment') this.totals.payFastFails++;
          this.emit(caller, DEP_NODE[dep], 'fail', 150);
          this.after(1, () => done(false, 'breaker'));
          return;
        }
        if (b.state === 'half') b.trials++;
      }
      if (policy.bulkhead > 0 && (this.inflight[dep] ?? 0) >= policy.bulkhead) {
        this.emit(caller, DEP_NODE[dep], 'fail', 150);
        this.after(1, () => done(false, 'bulkhead'));
        return;
      }
      this.inflight[dep] = (this.inflight[dep] ?? 0) + 1;
      const epoch = b.epoch;
      if (dep === 'payment') {
        this.totals.payAttempts++;
        this.sec.pay++;
      }
      if (dep === 'invReserve') this.invLoad.push(this.now);
      const s = this.sample(dep);
      const limit = policy.timeoutMs > 0 ? policy.timeoutMs : 60000;
      const wait = Math.min(s.lat, limit);
      const timedOut = s.lat > limit;
      this.emit(caller, DEP_NODE[dep], n > 1 ? 'retry' : 'call', wait);
      if (dep === 'payment') this.emit('payment', 'payco', 'call', wait);
      // the dependency keeps working even if we stop waiting
      if (Number.isFinite(s.lat) && s.ok && effect) this.after(s.lat, () => effect(n));
      this.after(wait, () => {
        this.inflight[dep]--;
        const ok = s.ok && !timedOut;
        this.record(dep, policy, ok, epoch);
        if (ok) return done(true, 'ok');
        const why = timedOut ? 'timeout' : 'error';
        if (n < maxAttempts && !(policy.breaker && this.breaker(dep).state === 'open')) {
          const backoff = policy.backoffMs * Math.pow(2, Math.min(n - 1, 6));
          const delay = policy.jitter ? this.rand() * backoff : backoff;
          this.after(Math.max(delay, 1), () => attempt(n + 1));
        } else done(false, why);
      });
    };
    attempt(1);
  }

  // ── following one customer
  tracked: Tracked[] = [];
  private stage(tr: Tracked | undefined, s: TrackStage) {
    if (!tr || tr.finished) return;
    tr.stage = s;
    tr.since = this.now;
    if (s === 'done' || s === 'message' || s === 'gaveup') tr.finished = true;
  }
  /** Start a checkout for a named customer the story follows. */
  trackCheckout(name: string): Tracked {
    const tr: Tracked = { name, kind: 'checkout', stage: 'waiting', start: this.now, since: this.now, finished: false };
    this.tracked.push(tr);
    this.checkout(undefined, 'mobile', tr);
    return tr;
  }
  /** Open "My orders" for a named customer the story follows. */
  trackMyOrders(name: string): Tracked {
    const tr: Tracked = { name, kind: 'myOrders', stage: 'waiting', start: this.now, since: this.now, finished: false };
    this.tracked.push(tr);
    this.myOrders(tr);
    return tr;
  }

  // ── checkout: the heart of the shop
  checkout(intentId?: number, client: 'web' | 'mobile' = this.client(), tr?: Tracked) {
    const c = this.cfg;
    const intent = intentId ?? this.id();
    const isRetry = intentId !== undefined;
    const start = this.now;
    const order = this.svc('order');
    this.entry(client, order, 'checkout');
    let finished = false;
    const finish = (outcome: 'ok' | 'message' | 'errorPage', unpaid = false) => {
      this.orderPool.release();
      if (finished) return;
      this.stage(tr, outcome === 'ok' ? 'done' : 'message');
      finished = true;
      const lat = this.now - start;
      this.totals.checkoutLatency.push(lat);
      this.sec.cLat.push(lat);
      if (outcome === 'ok') {
        if (unpaid) this.totals.unpaidOrders++;
        if (!isRetry) {
          this.totals.checkoutOk++;
          this.sec.cOk++;
          this.sec.happy++;
        }
        // the reply is lost on a weak signal: the app taps again
        if (client === 'mobile' && !isRetry && this.rand() < c.signalDrop) {
          this.emit(order, 'mobile', 'fail', 300);
          this.after(800, () => this.checkout(intent, 'mobile'));
        }
      } else if (!isRetry) {
        if (outcome === 'message') this.totals.checkoutMessage++;
        else this.totals.checkoutErrorPage++;
        this.sec.cFail++;
        this.sec.unhappy += outcome === 'message' ? 0.6 : 1;
      }
    };
    const w = this.orderPool.acquire(() => {
      this.stage(tr, 'seat');
      // idempotency key on the order API
      if (isRetry && c.serverIdempotency && this.intents.has(intent)) {
        this.totals.dupRejected++;
        this.after(5, () => finish('ok'));
        return;
      }
      if (isRetry) this.totals.duplicateOrders++;
      this.intents.set(intent, 'processing');
      const orderId = this.id();
      const mono = c.architecture === 'monolith';

      const fail = (fb: CallPolicy['fallback']) => finish(fb === 'none' || fb === 'omit' || fb === 'stale' ? 'errorPage' : 'message');

      const stepInventory = (next: () => void) => {
        if (mono) return this.after(5, next);
        this.call('inventory', c.inv, order, (ok) => {
          if (ok || c.inv.fallback === 'stale' || c.inv.fallback === 'omit') next();
          else fail(c.inv.fallback);
        });
      };
      let unpaid = false;
      const stepPay = (next: () => void) => {
        this.stage(tr, 'payment');
        this.call(
          'payment',
          c.pay,
          order,
          (ok) => {
            if (ok) return next();
            if (c.pay.fallback === 'pretend') {
              unpaid = true;
              return next();
            }
            fail(c.pay.fallback === 'omit' || c.pay.fallback === 'stale' ? 'none' : c.pay.fallback);
          },
          () => {
            // the payment company actually places a hold
            if (c.pay.idempotencyKey && this.holdsByOrder.has(orderId)) return;
            this.holdsByOrder.set(orderId, (this.holdsByOrder.get(orderId) ?? 0) + 1);
            const n = (this.chargesByIntent.get(intent) ?? 0) + 1;
            this.chargesByIntent.set(intent, n);
            if (n === 2) {
              this.totals.doubleCharges++;
              this.say('bad', `A customer was charged twice for one order.`);
            }
          },
        );
      };
      const stepRecs = (next: () => void) => {
        if (mono) return this.after(20, next);
        this.call('recs', c.recs, order, (ok) => {
          if (ok || c.recs.fallback === 'omit' || c.recs.fallback === 'stale') next();
          else fail(c.recs.fallback);
        });
      };
      const stepSave = (next: () => void) => {
        this.stage(tr, 'saving');
        this.emit(order, 'orderDb', 'db', 150);
        this.after(this.jitterLat(12), next);
      };
      const stepAfter = (next: () => void) => {
        if (mono) return this.after(30, next);
        if (c.postOrder === 'sync') {
          // call every service in turn and wait for each
          this.call('email', c.notif, order, (ok1) => {
            if (!ok1) return fail('none');
            this.call('shipping', c.notif, order, (ok2) => {
              if (!ok2) return fail('none');
              this.call('invReserve', c.inv, order, (ok3) => {
                if (!ok3) return fail('none');
                this.totals.emailsSent++;
                next();
              });
            });
          });
          return;
        }
        this.publishOrWrite(orderId, 'placed');
        if (c.cancelShare > 0 && this.rand() < c.cancelShare) this.after(300, () => this.publishOrWrite(orderId, 'cancel'));
        this.after(3, next);
      };
      stepInventory(() =>
        stepPay(() =>
          stepRecs(() =>
            stepSave(() =>
              stepAfter(() => {
                this.intents.set(intent, 'done');
                this.totals.ordersPlaced++;
                this.totals.revenue += 90;
                if (c.checkoutPriceFromCache && c.cache) {
                  const e = this.cache.get(0);
                  if (e && e.version < this.dbVersion[0] && this.rand() < 0.4) this.totals.wrongPrice++;
                }
                finish('ok', unpaid);
              }),
            ),
          ),
        ),
      );
    });
    this.after(PATIENCE.checkout, () => {
      if (!finished) {
        this.orderPool.cancel(w);
        this.stage(tr, 'gaveup');
        if (!isRetry) {
          finished = true;
          this.totals.checkoutFrozen++;
          this.sec.cFail++;
          this.sec.unhappy++;
        }
      }
    });
  }

  // ── events, outbox and the relay
  private publishOrWrite(orderId: number, kind: 'placed' | 'cancel') {
    const eventId = this.id();
    if (this.cfg.postOrder === 'outbox') {
      this.outbox.push({ orderId, eventId, kind, createdAt: this.now });
      this.emit(this.svc('order'), 'outbox', 'event', 200);
      return;
    }
    // saved, then published as a second step
    if (this.deps.broker.status === 'down' || this.rand() < this.env.crashBetween) {
      this.totals.lostEvents++;
      if (this.totals.lostEvents % 5 === 1) this.say('bad', `An order was saved but its event never left. Nobody will ship it.`);
      this.emit(this.svc('order'), 'broker', 'fail', 300);
      return;
    }
    this.emit(this.svc('order'), 'broker', 'event', 300);
    this.deliver(orderId, eventId, kind);
  }

  private relayTick() {
    if (this.cfg.postOrder !== 'outbox' || !this.outbox.length) return;
    const pollMs = this.cfg.relayMode === 'polling' ? 1000 : 100;
    if (Math.floor(this.now / 100) % (pollMs / 100) !== 0) return;
    if (this.env.relayStuck || this.deps.broker.status === 'down') return;
    const rows = this.outbox.splice(0, this.outbox.length);
    for (const r of rows) {
      this.emit('outbox', 'relay', 'event', 200);
      this.emit('relay', 'broker', 'event', 300);
      this.deliver(r.orderId, r.eventId, r.kind);
      // crashed after publishing, before marking the row sent: it will go again
      if (this.rand() < this.env.relayCrash) this.outbox.push(r);
    }
  }

  private deliver(orderId: number, eventId: number, kind: 'placed' | 'cancel') {
    this.after(20, () => {
      const poison = kind === 'placed' && this.rand() < this.env.poisonShare;
      this.queues.inv.msgs.push({ id: eventId, orderId, kind, deliveries: 0, visibleAt: this.now, poison, taken: false, createdAt: this.now });
      this.emit('broker', 'invWorkers', 'event', 300);
      this.pump(this.queues.inv);
      if (kind === 'placed') {
        this.queues.notif.msgs.push({ id: eventId, orderId, kind, deliveries: 0, visibleAt: this.now, poison: false, taken: false, createdAt: this.now });
        this.pump(this.queues.notif);
        if (this.env.saga) this.runSaga();
      }
    });
  }

  private pickMsg(q: Queue): Msg | undefined {
    for (const m of q.msgs) {
      if (m.taken || m.visibleAt > this.now) continue;
      if (q.name === 'inv' && this.cfg.partitionKey && q.busyOrders.has(m.orderId)) continue;
      return m;
    }
    return undefined;
  }

  private pump(q: Queue) {
    const cap = q.name === 'inv' ? this.workers : 2;
    while (q.busy < cap) {
      const m = this.pickMsg(q);
      if (!m) {
        // retry later if some messages are only hidden for now
        if (q.msgs.length) this.after(100, () => this.pump(q));
        return;
      }
      this.work(q, m);
    }
  }

  private ack(q: Queue, m: Msg) {
    const i = q.msgs.indexOf(m);
    if (i >= 0) q.msgs.splice(i, 1);
  }

  private work(q: Queue, m: Msg) {
    m.taken = true;
    m.deliveries++;
    const token = m.deliveries;
    q.busy++;
    q.busyOrders.set(m.orderId, (q.busyOrders.get(m.orderId) ?? 0) + 1);
    // if the worker takes too long, the message becomes visible again
    this.after(VISIBILITY_MS, () => {
      if (m.taken && m.deliveries === token && q.msgs.includes(m)) {
        m.taken = false;
        this.pump(q);
      }
    });
    const end = () => {
      q.busy--;
      const n = (q.busyOrders.get(m.orderId) ?? 1) - 1;
      if (n <= 0) q.busyOrders.delete(m.orderId);
      else q.busyOrders.set(m.orderId, n);
      this.pump(q);
    };

    if (q.name === 'notif') {
      this.after(this.jitterLat(50), () => {
        const s = this.sample('email');
        this.emit('notifWorkers', 'email', s.ok ? 'call' : 'fail', 250);
        if (s.ok) {
          this.totals.emailsSent++;
          this.ack(q, m);
        } else {
          m.taken = false;
          m.visibleAt = this.now + Math.min(16000, 1000 * Math.pow(2, m.deliveries - 1));
        }
        end();
      });
      return;
    }

    // inventory worker
    const c = this.cfg;
    if (c.idempotentHandlers) {
      const seen = this.processed.has(m.id) || (c.uniqueConstraint && this.inProgress.has(m.id));
      if (seen) {
        this.totals.dupRejected++;
        this.ack(q, m);
        end();
        return;
      }
    }
    this.inProgress.set(m.id, (this.inProgress.get(m.id) ?? 0) + 1);
    const overload = Math.max(1, q.busy / INV_DB_LIMIT);
    let dur = this.exp(60) * overload * overload;
    if (this.rand() < this.env.slowTail) dur += 400 + this.rand() * 2500;
    this.emit('invWorkers', 'inventory', 'db', dur);
    this.after(dur, () => {
      const left = (this.inProgress.get(m.id) ?? 1) - 1;
      if (left <= 0) this.inProgress.delete(m.id);
      else this.inProgress.set(m.id, left);
      if (m.poison) {
        this.totals.poisonRetries++;
        if (c.maxDeliveries > 0 && m.deliveries >= c.maxDeliveries) {
          this.ack(q, m);
          if (c.dlq) {
            this.totals.dlqIn++;
            this.dlq.push({ id: m.id, orderId: m.orderId, error: 'Unknown product ID "SH-00?" (sent by app v2.3)', attempts: m.deliveries, fixable: true });
            this.emit('invWorkers', 'dlq', 'fail', 300);
            this.say('warn', `Message for order #${m.orderId} moved to the dead letter queue after ${m.deliveries} tries.`);
          } else {
            this.totals.lostMessages++;
            this.say('bad', `Message for order #${m.orderId} was dropped. That order will never be reserved.`);
          }
        } else {
          m.taken = false;
          m.visibleAt = this.now + 200;
          this.emit('invWorkers', 'invWorkers', 'fail', 200);
        }
        end();
        return;
      }
      // apply the work
      if (m.kind === 'placed') {
        if (this.processed.has(m.id)) {
          this.totals.doubleReserve++;
          if (this.totals.doubleReserve % 5 === 1) this.say('bad', `The same order reserved stock twice. Stock count is now wrong.`);
        } else {
          this.processed.add(m.id);
          this.reserved.add(m.orderId);
          if (this.cancelledEarly.has(m.orderId)) {
            this.totals.ghostReservations++;
            this.say('bad', `Shoes reserved for order #${m.orderId}, which was already cancelled.`);
          }
        }
      } else {
        this.processed.add(m.id);
        if (!this.reserved.has(m.orderId)) this.cancelledEarly.add(m.orderId);
        else this.reserved.delete(m.orderId);
      }
      // crash after doing the work, before saying "got it"
      if (this.rand() < this.env.workerCrash) {
        this.emit('invWorkers', 'broker', 'fail', 200);
        end();
        return; // message stays hidden until the visibility timeout, then comes back
      }
      this.ack(q, m);
      end();
    });
  }

  /** Operator replays (or discards) messages in the dead letter queue. */
  replayDlq(id: number, action: 'replay' | 'discard') {
    const i = this.dlq.findIndex((d) => d.id === id);
    if (i < 0) return;
    const d = this.dlq.splice(i, 1)[0];
    if (action === 'replay') {
      this.queues.inv.msgs.push({ id: d.id, orderId: d.orderId, kind: 'placed', deliveries: 0, visibleAt: this.now, poison: false, taken: false, createdAt: this.now });
      this.emit('dlq', 'invWorkers', 'event', 400);
      this.say('good', `Fixed data and replayed order #${d.orderId}.`);
      this.pump(this.queues.inv);
    } else this.say('info', `Discarded message for order #${d.orderId}.`);
  }

  // ── saga: order → reserve stock → book delivery → capture money
  private runSaga() {
    this.sagasRunning++;
    const order = this.cfg.sagaOrder.split('>').filter((x): x is 'reserve' | 'book' | 'capture' => ['reserve', 'book', 'capture'].includes(x));
    const done: ('reserve' | 'book' | 'capture')[] = [];
    const failP = { reserve: this.env.reserveFail, book: this.env.bookFail, capture: this.env.captureFail };
    const node = { reserve: 'invWorkers', book: 'shipping', capture: 'payment' };
    const step = (i: number) => {
      if (i >= order.length) {
        this.sagasRunning--;
        this.totals.sagaConfirmed++;
        return;
      }
      const s = order[i];
      const hang = s === 'book' && this.env.shippingHang;
      this.emit('order', node[s], 'event', 200);
      if (hang) {
        if (this.cfg.sagaStepTimeout) this.after(3000, () => fail());
        else {
          this.totals.stuckSagas++;
          // stays pending forever
        }
        return;
      }
      this.after(this.jitterLat(150), () => {
        if (this.rand() < failP[s]) fail();
        else {
          done.push(s);
          step(i + 1);
        }
      });
    };
    const fail = () => {
      this.sagasRunning--;
      if (this.cfg.sagaCompensate) {
        this.totals.sagaCompensated++;
        if (done.includes('capture')) this.totals.refunds++;
        for (const s of done) this.emit('order', node[s], 'fail', 250);
      } else {
        if (done.includes('reserve')) this.totals.leakedStock++;
        if (done.includes('book')) this.totals.leakedDelivery++;
        if (done.includes('capture')) this.totals.chargedNoShoes++;
      }
    };
    step(0);
  }

  // ── my orders page
  private myOrders(tr?: Tracked) {
    const c = this.cfg;
    const start = this.now;
    const client = tr ? 'mobile' : this.client();
    if (c.myOrdersMode === 'readModel') {
      this.entry(client, 'readModel', 'browse');
      this.after(this.jitterLat(25), () => {
        const justOrdered = this.rand() < 0.3;
        if (justOrdered && this.env.projectionLagMs > 800 && !c.readYourWrites) this.totals.missingOrder++;
        this.totals.myOrdersOk++;
        this.totals.myOrdersLatency.push(this.now - start);
        this.sec.mLat.push(this.now - start);
      });
      return;
    }
    if (this.env.orderHistorySplit && !c.gateway && client === 'mobile') {
      // old app versions still call the old address
      this.emit('mobile', 'order', 'fail', 300);
      this.totals.myOrdersFail++;
      this.sec.unhappy++;
      return;
    }
    const order = this.svc('order');
    this.entry(client, order, 'browse');
    let finished = false;
    const w = this.orderPool.acquire(() => {
      this.stage(tr, 'seat');
      const ship = this.sample('shipping');
      const lat = Math.max(Number.isFinite(ship.lat) ? ship.lat : 60000, this.jitterLat(30));
      if (c.architecture === 'services') this.emit(order, 'shipping', 'call', lat);
      this.after(Math.min(lat, 60000), () => {
        this.orderPool.release();
        if (finished) return;
        finished = true;
        this.stage(tr, 'done');
        const total = this.now - start;
        this.totals.myOrdersOk++;
        this.totals.myOrdersLatency.push(total);
        this.sec.mLat.push(total);
        this.sec.happy += 0.5;
      });
    });
    this.after(PATIENCE.myOrders, () => {
      if (!finished) {
        finished = true;
        this.stage(tr, 'gaveup');
        this.orderPool.cancel(w);
        this.totals.myOrdersFail++;
        this.sec.unhappy++;
      }
    });
  }

  // ── account page on a phone (gateway aggregation)
  private account() {
    const c = this.cfg;
    const rtt = () => 350 + this.rand() * 400;
    const svcLat = (dep: DepName) => {
      const s = this.sample(dep);
      return Number.isFinite(s.lat) ? s.lat : 60000;
    };
    let lat: number;
    let ok: boolean;
    if (c.accountMode === 'client' || !c.gateway) {
      lat = Math.max(rtt() + 40, rtt() + 40, rtt() + svcLat('recs'));
      ok = this.rand() > 0.03 && this.rand() > 0.03 && this.rand() > 0.03;
      for (const t of ['order', 'payment', 'recs']) this.emit('mobile', t, 'call', 700);
    } else {
      const recs = svcLat('recs');
      const inner = c.aggTimeoutMs > 0 ? Math.min(recs, c.aggTimeoutMs) : recs;
      lat = rtt() + Math.max(40, inner);
      ok = this.rand() > 0.03;
      this.emit('mobile', 'gateway', 'browse', 600);
      for (const t of ['order', 'payment', 'recs']) this.emit('gateway', t, 'call', 200);
    }
    this.after(lat, () => {
      if (ok && lat < 6000) {
        this.totals.accountOk++;
        this.totals.accountLatency.push(lat);
      } else this.totals.accountFail++;
    });
  }

  // ── once per simulated second
  private tickSecond() {
    const c = this.cfg;
    const s = this.sec;
    // inventory load (sync reservations) and crash
    this.invLoad = this.invLoad.filter((t) => this.now - t < 1000);
    if (c.postOrder === 'sync' && this.invLoad.length / 17 > 1.3) {
      this.invOverSec++;
      if (this.invOverSec >= 4 && this.deps.invReserve.status === 'up') {
        this.deps.invReserve.status = 'down';
        this.totals.invCrashes++;
        this.say('bad', 'Inventory service ran out of memory and crashed.');
        this.after(8000, () => {
          this.deps.invReserve.status = 'up';
          this.invOverSec = 0;
          this.say('info', 'Inventory service restarted.');
        });
      }
    } else this.invOverSec = 0;

    // autoscaling workers by queue depth
    const q = this.queues.inv;
    if (c.autoscale) {
      const target = Math.max(1, Math.min(c.autoscaleMax, Math.ceil(q.msgs.length / 40)));
      if (target !== this.workers) this.workers = target;
      this.pump(q);
    }
    if (q.busy > INV_DB_LIMIT) {
      this.totals.dbOverloadSec++;
      if (this.totals.dbOverloadSec % 10 === 1) this.say('bad', `${q.busy} workers are hammering the inventory database. Everything slows down.`);
    }

    let firstAge = 0;
    for (let i = 0; i < Math.min(q.msgs.length, 300); i++) firstAge = Math.max(firstAge, (this.now - q.msgs[i].createdAt) / 1000);
    this.totals.maxMsgAgeSec = Math.max(this.totals.maxMsgAgeSec, firstAge);

    // outbox age & alerts
    const outboxAge = this.outbox.length ? (this.now - this.outbox[0].createdAt) / 1000 : 0;
    if (this.totals.alertFiredAt < 0) {
      if (c.alertOn === 'outboxAge' && outboxAge > 10) {
        this.totals.alertFiredAt = this.now;
        this.say('warn', `🔔 ALERT: oldest unsent outbox row is ${outboxAge.toFixed(0)}s old. On-call engineer paged.`);
      }
      if (c.alertOn === 'relayRunning' && !this.relayRunning) {
        this.totals.alertFiredAt = this.now;
        this.say('warn', '🔔 ALERT: relay process stopped.');
      }
    }

    // the on-call engineer fixes the relay a few seconds after being paged
    if (this.env.relayStuck && this.totals.alertFiredAt >= 0 && this.now - this.totals.alertFiredAt > 4000) {
      this.env.relayStuck = false;
      this.say('good', 'On-call engineer reconnected the relay. Waiting events are flowing again.');
    }

    const payRps = s.pay;
    this.totals.peakPayRps = Math.max(this.totals.peakPayRps, payRps);
    this.totals.peakDbWaiting = Math.max(this.totals.peakDbWaiting, this.dbPool.waiting);

    const tot = s.happy + s.unhappy;
    if (tot > 0) this.happiness = this.happiness * 0.8 + (100 * s.happy) / tot * 0.2;

    const cost = hourlyCost(c, this.workers);
    this.totals.cost += cost / 3600;

    this.history.push({
      t: Math.round(this.now / 1000),
      checkoutOk: s.cOk,
      checkoutFail: s.cFail,
      browseOk: s.bOk,
      browseFail: s.bFail,
      p95Checkout: p95(s.cLat),
      p95Browse: p95(s.bLat),
      p95MyOrders: p95(s.mLat),
      orderThreads: this.orderPool.used,
      orderThreadsMax: this.orderPool.size,
      payRps,
      invDepth: q.msgs.length,
      invWorkers: this.workers,
      oldestMsgSec: firstAge,
      dlq: this.dlq.length,
      outbox: this.outbox.length,
      outboxAge,
      hitRate: s.hits + s.misses ? s.hits / (s.hits + s.misses) : 0,
      dbLoad: (this.dbPool.used + this.dbPool.waiting) / this.dbPool.size,
      dbWaiting: this.dbPool.waiting,
      rejected429: s.r429,
      happiness: Math.round(this.happiness),
    });
    if (this.history.length > 600) this.history.shift();
    // free play runs forever: keep latency samples bounded
    for (const k of ['checkoutLatency', 'browseLatency', 'myOrdersLatency', 'accountLatency'] as const) {
      const arr = this.totals[k];
      if (arr.length > 30000) arr.splice(0, arr.length - 20000);
    }
    this.sec = this.freshSec();
    // forget old packets
    this.packets = this.packets.filter((p) => p.t1 > this.now);
  }

  // ── live readouts for the map
  readout() {
    const b = (d: string) => this.breakers[d]?.state ?? 'closed';
    return {
      orderThreads: this.orderPool.used,
      orderMax: this.orderPool.size,
      orderWaiting: this.orderPool.waiting,
      productThreads: this.productPool.used,
      productMax: this.productPool.size,
      dbUsed: this.dbPool.used,
      dbWaiting: this.dbPool.waiting,
      invDepth: this.queues.inv.msgs.length,
      invBusy: this.queues.inv.busy,
      notifDepth: this.queues.notif.msgs.length,
      workers: this.workers,
      outbox: this.outbox.length,
      dlq: this.dlq.length,
      cacheKeys: this.cache.size,
      breakers: { payment: b('payment'), recs: b('recs'), inventory: b('inventory') },
      inflight: { ...this.inflight },
      deps: Object.fromEntries(Object.entries(this.deps).map(([k, v]) => [k, v.status])) as Record<DepName, DepStatus>,
      sagas: this.sagasRunning,
      happiness: Math.round(this.happiness),
    };
  }
}

export type Readout = ReturnType<Sim['readout']>;
