// Every setting a player can change, with a plain-language explanation.

export interface ControlDef {
  key: string;
  path: string;
  label: string;
  tip: string;
  group: string;
  kind: 'toggle' | 'slider' | 'select';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string | number; label: string }[];
  zeroLabel?: string;
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}s` : `${v}ms`);
export const fmtMs = ms;

const fallbackOptions = [
  { value: 'none', label: 'Show an error page' },
  { value: 'message', label: 'Show a clear message' },
  { value: 'omit', label: 'Leave that part out' },
  { value: 'stale', label: 'Use a saved copy' },
  { value: 'pretend', label: 'Pretend it worked' },
];

const policyControls = (dep: 'pay' | 'recs' | 'inv', name: string): ControlDef[] => [
  {
    key: `${dep}.timeoutMs`,
    path: `${dep}.timeoutMs`,
    label: `${name} timeout`,
    tip: `How long the order service waits for ${name.toLowerCase()} before giving up. "No limit" means it waits as long as it takes, holding a thread the whole time.`,
    group: name,
    kind: 'slider',
    min: 0,
    max: 30000,
    step: 100,
    unit: 'ms',
    zeroLabel: 'No limit',
  },
  {
    key: `${dep}.retries`,
    path: `${dep}.retries`,
    label: `${name} retries`,
    tip: 'How many extra tries after a failed call. Retries help with short blips but add load to a struggling service.',
    group: name,
    kind: 'slider',
    min: 0,
    max: 5,
    step: 1,
  },
  {
    key: `${dep}.backoffMs`,
    path: `${dep}.backoffMs`,
    label: 'Backoff',
    tip: 'Wait before each retry, doubling every time (1s, 2s, 4s…). Gives a struggling service room to recover.',
    group: name,
    kind: 'slider',
    min: 0,
    max: 2000,
    step: 100,
    unit: 'ms',
    zeroLabel: 'Retry at once',
  },
  {
    key: `${dep}.jitter`,
    path: `${dep}.jitter`,
    label: 'Jitter',
    tip: 'Make each retry wait a random amount, so a thousand failed callers don’t all come back at the same moment.',
    group: name,
    kind: 'toggle',
  },
  {
    key: `${dep}.idempotencyKey`,
    path: `${dep}.idempotencyKey`,
    label: 'Idempotency key',
    tip: 'Send the same unique key on every attempt. If the first attempt already worked, the other side returns that result instead of doing it again.',
    group: name,
    kind: 'toggle',
  },
  {
    key: `${dep}.breaker`,
    path: `${dep}.breaker`,
    label: 'Circuit breaker',
    tip: 'Watches calls to this service. When too many fail, it stops calling for a while and fails fast. Then it lets a few trial calls through (half-open).',
    group: name,
    kind: 'toggle',
  },
  {
    key: `${dep}.breakerThreshold`,
    path: `${dep}.breakerThreshold`,
    label: 'Trips when failures over',
    tip: 'Share of the last 20 calls that must fail before the breaker opens. It waits for at least 10 calls first.',
    group: name,
    kind: 'slider',
    min: 0.1,
    max: 0.9,
    step: 0.1,
    unit: '%',
  },
  {
    key: `${dep}.breakerOpenMs`,
    path: `${dep}.breakerOpenMs`,
    label: 'Stay open for',
    tip: 'How long the breaker blocks calls before it tries a few trial calls.',
    group: name,
    kind: 'slider',
    min: 1000,
    max: 20000,
    step: 1000,
    unit: 'ms',
  },
  {
    key: `${dep}.bulkhead`,
    path: `${dep}.bulkhead`,
    label: 'Bulkhead (max calls at once)',
    tip: 'Gives this service its own small share. If that many calls are already waiting, the next one is turned away at once instead of tying up another thread.',
    group: name,
    kind: 'slider',
    min: 0,
    max: 100,
    step: 5,
    zeroLabel: 'Shared pool',
  },
  {
    key: `${dep}.fallback`,
    path: `${dep}.fallback`,
    label: 'If it fails',
    tip: 'What the customer sees when this call fails. Optional parts can disappear. Essential parts need a clear message.',
    group: name,
    kind: 'select',
    options: fallbackOptions,
  },
];

export const CONTROLS: ControlDef[] = [
  // structure
  {
    key: 'architecture',
    path: 'architecture',
    label: 'Architecture',
    tip: 'A modular monolith ships everything as one program. Services let each part deploy and scale on its own, but they talk over a network.',
    group: 'Structure',
    kind: 'select',
    options: [
      { value: 'monolith', label: 'Modular monolith' },
      { value: 'services', label: 'Separate services' },
    ],
  },
  {
    key: 'monolithCopies',
    path: 'monolithCopies',
    label: 'Monolith copies',
    tip: 'Each copy runs the whole shop: accounts, products, orders, emails. $220/h each, even if only orders need help.',
    group: 'Structure',
    kind: 'slider',
    min: 1,
    max: 6,
    step: 1,
  },
  {
    key: 'orderInstances',
    path: 'orderInstances',
    label: 'Order service servers',
    tip: 'Copies of just the order service. Each has 100 threads. $60/h each.',
    group: 'Structure',
    kind: 'slider',
    min: 1,
    max: 8,
    step: 1,
  },
  {
    key: 'productInstances',
    path: 'productInstances',
    label: 'Product service servers',
    tip: 'Copies of the product service. Each has 100 threads. $40/h each.',
    group: 'Structure',
    kind: 'slider',
    min: 1,
    max: 8,
    step: 1,
  },

  // front door
  {
    key: 'gateway',
    path: 'gateway',
    label: 'API gateway',
    tip: 'One front door for every request. Apps only know its address; it routes each request to the right service and runs shared checks.',
    group: 'Front door',
    kind: 'toggle',
  },
  {
    key: 'gatewayCopies',
    path: 'gatewayCopies',
    label: 'Gateway copies',
    tip: 'Running several copies keeps the front door up if one fails. $25/h each.',
    group: 'Front door',
    kind: 'slider',
    min: 1,
    max: 10,
    step: 1,
  },
  {
    key: 'rateLimit',
    path: 'rateLimit',
    label: 'Rate limit (per client)',
    tip: 'Most requests one client may send per minute. Extra requests get a 429 "Too many requests" at the gateway, which costs almost nothing.',
    group: 'Front door',
    kind: 'slider',
    min: 0,
    max: 3000,
    step: 50,
    unit: '/min',
    zeroLabel: 'Off',
  },
  {
    key: 'rateLimitBurst',
    path: 'rateLimitBurst',
    label: 'Token bucket size',
    tip: 'How big a short burst a client may send. A real person’s app loads several things at once; the average still can’t go over the limit.',
    group: 'Front door',
    kind: 'slider',
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'rateLimitShared',
    path: 'rateLimitShared',
    label: 'Shared counter for all copies',
    tip: 'If each gateway copy counts on its own, a client spread across 10 copies gets 10× the limit. A fast shared store fixes that.',
    group: 'Front door',
    kind: 'toggle',
  },
  {
    key: 'accountMode',
    path: 'accountMode',
    label: 'Account page',
    tip: 'Either the phone makes three calls over its slow network, or it makes one call and the gateway gathers the three answers on the fast inside network.',
    group: 'Front door',
    kind: 'select',
    options: [
      { value: 'client', label: 'App calls 3 services' },
      { value: 'aggregate', label: 'Gateway gathers them' },
    ],
  },
  {
    key: 'aggTimeoutMs',
    path: 'aggTimeoutMs',
    label: 'Gateway waits for each part',
    tip: 'If a part (like recommendations) is late, return the page without it.',
    group: 'Front door',
    kind: 'slider',
    min: 0,
    max: 3000,
    step: 100,
    unit: 'ms',
    zeroLabel: 'Wait for all',
  },

  // messaging
  {
    key: 'postOrderBasic',
    path: 'postOrder',
    label: 'After an order is saved',
    tip: 'Call every service in turn and wait for each, or announce "order placed" as an event and let other services react on their own time.',
    group: 'Messaging',
    kind: 'select',
    options: [
      { value: 'sync', label: 'Call each service and wait' },
      { value: 'events', label: 'Publish an event' },
    ],
  },
  {
    key: 'postOrder',
    path: 'postOrder',
    label: 'After an order is saved',
    tip: 'Calls: wait for each service. Event: save, then publish (two separate writes). Outbox: save the order and the event in one transaction; a relay sends it later.',
    group: 'Messaging',
    kind: 'select',
    options: [
      { value: 'sync', label: 'Call each service and wait' },
      { value: 'events', label: 'Save, then publish event' },
      { value: 'outbox', label: 'Transactional outbox' },
    ],
  },
  {
    key: 'relayMode',
    path: 'relayMode',
    label: 'Relay',
    tip: 'Polling asks the outbox for new rows every second. Log tailing reads the database’s change log and sees rows almost at once.',
    group: 'Messaging',
    kind: 'select',
    options: [
      { value: 'polling', label: 'Polling (every 1s)' },
      { value: 'log', label: 'Log tailing (~0.1s)' },
    ],
  },
  {
    key: 'invWorkers',
    path: 'invWorkers',
    label: 'Inventory workers',
    tip: 'Copies of the inventory consumer reading the same queue. Each handles about 1,000 reservations a minute. More than 12 overload the inventory database.',
    group: 'Messaging',
    kind: 'slider',
    min: 1,
    max: 40,
    step: 1,
  },
  {
    key: 'autoscale',
    path: 'autoscale',
    label: 'Autoscale workers',
    tip: 'Start more workers when the queue grows and stop them when it empties.',
    group: 'Messaging',
    kind: 'toggle',
  },
  {
    key: 'autoscaleMax',
    path: 'autoscaleMax',
    label: 'Autoscale maximum',
    tip: 'Always set a ceiling. 50 workers can overload the database behind them.',
    group: 'Messaging',
    kind: 'slider',
    min: 1,
    max: 50,
    step: 1,
  },
  {
    key: 'partitionKey',
    path: 'partitionKey',
    label: 'Partition by order ID',
    tip: 'Messages with the same key go to one worker at a time, in order. Different orders still run in parallel.',
    group: 'Messaging',
    kind: 'toggle',
  },
  {
    key: 'serverIdempotency',
    path: 'serverIdempotency',
    label: 'Idempotency key on "place order"',
    tip: 'The app creates one key when the customer taps the button and sends it on every retry. The order service returns the saved result for a key it has seen.',
    group: 'Messaging',
    kind: 'toggle',
  },
  {
    key: 'idempotentHandlers',
    path: 'idempotentHandlers',
    label: 'Check processed message IDs',
    tip: 'The worker keeps a table of event IDs it already handled and skips repeats.',
    group: 'Messaging',
    kind: 'toggle',
  },
  {
    key: 'uniqueConstraint',
    path: 'uniqueConstraint',
    label: 'Unique constraint on message ID',
    tip: 'Let the database refuse a second row with the same ID, inside the same transaction as the work. Stops two workers racing on one message.',
    group: 'Messaging',
    kind: 'toggle',
  },
  {
    key: 'maxDeliveries',
    path: 'maxDeliveries',
    label: 'Give up after',
    tip: 'How many times the queue hands out a failing message before it stops.',
    group: 'Messaging',
    kind: 'slider',
    min: 0,
    max: 10,
    step: 1,
    unit: ' tries',
    zeroLabel: 'Never give up',
  },
  {
    key: 'dlq',
    path: 'dlq',
    label: 'Dead letter queue',
    tip: 'When a message gives up, move it to a separate queue for a person to read, fix and replay, instead of deleting it.',
    group: 'Messaging',
    kind: 'toggle',
  },

  // calls
  ...policyControls('pay', 'Payment'),
  ...policyControls('recs', 'Recommendations'),
  ...policyControls('inv', 'Inventory check'),
  {
    key: 'retryLayers',
    path: 'retryLayers',
    label: 'Layers that retry',
    tip: 'If the web app, the order service and the payment service each retry 3 times, one click can become 27 calls. Pick one layer to retry.',
    group: 'Payment',
    kind: 'slider',
    min: 1,
    max: 3,
    step: 1,
  },

  // cache
  {
    key: 'cache',
    path: 'cache',
    label: 'Cache (cache-aside)',
    tip: 'Keep a fast copy of product pages beside the product service. Check it first; on a miss, read the database and store a copy.',
    group: 'Cache',
    kind: 'toggle',
  },
  {
    key: 'cacheTtlSec',
    path: 'cacheTtlSec',
    label: 'TTL (time to live)',
    tip: 'How long a copy may stay before the cache drops it. Long = more stale data. Short = more database work.',
    group: 'Cache',
    kind: 'slider',
    min: 5,
    max: 3600,
    step: 5,
    unit: 's',
  },
  {
    key: 'ttlJitter',
    path: 'ttlJitter',
    label: 'TTL jitter',
    tip: 'Add a small random amount to each TTL so thousands of copies don’t expire in the same minute.',
    group: 'Cache',
    kind: 'toggle',
  },
  {
    key: 'coalescing',
    path: 'coalescing',
    label: 'Request coalescing',
    tip: 'When a popular copy is missing, only one request rebuilds it. The others wait for that result.',
    group: 'Cache',
    kind: 'toggle',
  },
  {
    key: 'earlyRefresh',
    path: 'earlyRefresh',
    label: 'Early refresh',
    tip: 'Rebuild a hot copy shortly before it expires, so it is never empty while the crowd reads it.',
    group: 'Cache',
    kind: 'toggle',
  },
  {
    key: 'invalidateOnWrite',
    path: 'invalidateOnWrite',
    label: 'Shop app deletes copy on write',
    tip: 'Update the database first, then delete the cached copy. The next read gets the fresh value.',
    group: 'Cache',
    kind: 'toggle',
  },
  {
    key: 'adminInvalidates',
    path: 'adminInvalidates',
    label: 'Admin tool deletes copy on write',
    tip: 'Every path that changes a price must delete the copy: the app, the admin tool, the nightly import.',
    group: 'Cache',
    kind: 'toggle',
  },
  {
    key: 'checkoutPriceFromCache',
    path: 'checkoutPriceFromCache',
    label: 'Checkout reads price from cache',
    tip: 'Data that must be exact, like the price a customer pays, should come from the database.',
    group: 'Cache',
    kind: 'toggle',
  },

  // saga
  {
    key: 'sagaCompensate',
    path: 'sagaCompensate',
    label: 'Compensations',
    tip: 'When a later step fails, run new steps that reverse the earlier ones: release the pair, cancel the delivery, refund the money.',
    group: 'Saga',
    kind: 'toggle',
  },
  {
    key: 'sagaOrder',
    path: 'sagaOrder',
    label: 'Step order',
    tip: 'Put the step that is hardest to reverse as late as you can. Refunds are slow, cost fees and customers notice them.',
    group: 'Saga',
    kind: 'select',
    options: [
      { value: 'capture>reserve>book', label: 'Capture money → reserve → book' },
      { value: 'reserve>book>capture', label: 'Reserve → book → capture money' },
    ],
  },
  {
    key: 'sagaStepTimeout',
    path: 'sagaStepTimeout',
    label: 'Step timeouts',
    tip: 'If a step neither succeeds nor fails, give up after a while and compensate. Otherwise the order sits “pending” forever.',
    group: 'Saga',
    kind: 'toggle',
  },

  // reads
  {
    key: 'myOrdersMode',
    path: 'myOrdersMode',
    label: '"My orders" page reads from',
    tip: 'Ask three services on every view, or read one ready-made record kept current by a projection (CQRS).',
    group: 'Reads',
    kind: 'select',
    options: [
      { value: 'callThree', label: 'Three services, every view' },
      { value: 'readModel', label: 'Read model (CQRS)' },
    ],
  },
  {
    key: 'readYourWrites',
    path: 'readYourWrites',
    label: 'Show new order from the reply',
    tip: 'The read model lags a little. Show the order the app just placed from the response it already has (“reading your own writes”).',
    group: 'Reads',
    kind: 'toggle',
  },

  // observability
  {
    key: 'alertOn',
    path: 'alertOn',
    label: 'Page the on-call engineer when',
    tip: 'Alert on the signal that means lost work, not on whether a process is running.',
    group: 'Observability',
    kind: 'select',
    options: [
      { value: 'none', label: 'Never' },
      { value: 'relayRunning', label: 'Relay process stops' },
      { value: 'outboxAge', label: 'Oldest unsent outbox row > 10s' },
    ],
  },
];

export const CONTROL_MAP = Object.fromEntries(CONTROLS.map((c) => [c.key, c]));

export function formatValue(def: ControlDef, v: unknown): string {
  if (def.kind === 'toggle') return v ? 'On' : 'Off';
  if (def.kind === 'select') return def.options?.find((o) => o.value === v)?.label ?? String(v);
  const n = Number(v);
  if (n === 0 && def.zeroLabel) return def.zeroLabel;
  if (def.unit === 'ms') return ms(n);
  if (def.unit === '%') return `${Math.round(n * 100)}%`;
  return `${n}${def.unit ?? ''}`;
}
