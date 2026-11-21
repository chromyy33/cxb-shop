// Shared types for the CXB Shop simulation.

export type DepStatus = 'up' | 'slow' | 'down' | 'flaky';
export type Fallback = 'none' | 'omit' | 'stale' | 'message' | 'pretend';

/** How one service calls another. Mirrors the "careful call" settings from the course. */
export interface CallPolicy {
  timeoutMs: number; // 0 = wait forever
  retries: number; // extra attempts after the first
  backoffMs: number; // 0 = retry immediately
  jitter: boolean;
  idempotencyKey: boolean;
  breaker: boolean;
  breakerThreshold: number; // failure share that trips the breaker (0-1)
  breakerOpenMs: number;
  bulkhead: number; // 0 = shares the main thread pool with no limit
  fallback: Fallback;
}

export interface SimConfig {
  // ── traffic (requests per second)
  browseRps: number;
  checkoutRps: number;
  myOrdersRps: number;
  accountRps: number;
  botRps: number;
  mobileShare: number; // share of checkouts from the mobile app
  signalDrop: number; // chance a mobile reply is lost and the app taps again
  cancelShare: number; // share of orders cancelled right after placing

  // ── structure
  architecture: 'monolith' | 'services';
  monolithCopies: number;
  orderInstances: number;
  orderThreads: number; // threads per instance
  productInstances: number;
  productThreads: number;

  // ── front door
  gateway: boolean;
  gatewayCopies: number;
  rateLimit: number; // requests per minute per client, 0 = off
  rateLimitBurst: number;
  rateLimitShared: boolean;
  accountMode: 'client' | 'aggregate';
  aggTimeoutMs: number; // 0 = wait for every service

  // ── after the order is saved
  postOrder: 'sync' | 'events' | 'outbox';
  relayMode: 'polling' | 'log';
  serverIdempotency: boolean;

  // ── queues & workers
  invWorkers: number;
  autoscale: boolean;
  autoscaleMax: number;
  idempotentHandlers: boolean;
  uniqueConstraint: boolean;
  partitionKey: boolean;
  maxDeliveries: number; // 0 = retry forever
  dlq: boolean;

  // ── calls
  pay: CallPolicy;
  inv: CallPolicy;
  recs: CallPolicy;
  notif: CallPolicy;
  retryLayers: number;

  // ── cache
  cache: boolean;
  cacheTtlSec: number;
  ttlJitter: boolean;
  coalescing: boolean;
  earlyRefresh: boolean;
  invalidateOnWrite: boolean;
  adminInvalidates: boolean;
  checkoutPriceFromCache: boolean;

  // ── saga
  sagaCompensate: boolean;
  sagaOrder: string; // steps joined by '>', e.g. 'reserve>book>capture'
  sagaStepTimeout: boolean;

  // ── reads
  myOrdersMode: 'callThree' | 'readModel';
  readYourWrites: boolean;

  // ── observability
  alertOn: 'none' | 'relayRunning' | 'outboxAge';
}

export interface Totals {
  checkoutOk: number;
  checkoutErrorPage: number; // ugly failure
  checkoutMessage: number; // clear "try again" message
  checkoutFrozen: number; // customer gave up waiting
  browseOk: number;
  browseFrozen: number;
  myOrdersOk: number;
  myOrdersFail: number;
  missingOrder: number; // "where is my order?"
  accountOk: number;
  accountFail: number;
  botPassed: number;
  rejected429: number;
  payAttempts: number;
  payFastFails: number;
  doubleCharges: number;
  duplicateOrders: number;
  unpaidOrders: number;
  lostEvents: number;
  doubleReserve: number;
  ghostReservations: number;
  dupRejected: number;
  poisonRetries: number;
  lostMessages: number;
  dlqIn: number;
  staleReads: number;
  wrongPrice: number;
  cacheHits: number;
  cacheMisses: number;
  dbQueries: number;
  sagaConfirmed: number;
  sagaCompensated: number;
  leakedStock: number;
  leakedDelivery: number;
  refunds: number;
  stuckSagas: number;
  emailsSent: number;
  ordersPlaced: number;
  revenue: number;
  cost: number;
  alertFiredAt: number; // -1 = never
  chargedNoShoes: number;
  peakPayRps: number;
  peakDbWaiting: number;
  maxMsgAgeSec: number;
  dbOverloadSec: number;
  invCrashes: number;
  checkoutLatency: number[];
  browseLatency: number[];
  myOrdersLatency: number[];
  accountLatency: number[];
}

export interface Snapshot {
  t: number;
  checkoutOk: number;
  checkoutFail: number;
  browseOk: number;
  browseFail: number;
  p95Checkout: number;
  p95Browse: number;
  p95MyOrders: number;
  orderThreads: number;
  orderThreadsMax: number;
  payRps: number;
  invDepth: number;
  invWorkers: number;
  oldestMsgSec: number;
  dlq: number;
  outbox: number;
  outboxAge: number;
  hitRate: number;
  dbLoad: number; // 0..1+
  dbWaiting: number;
  rejected429: number;
  happiness: number;
}

export interface Packet {
  from: string;
  to: string;
  kind: PacketKind;
  t0: number; // sim ms
  t1: number;
}

export type PacketKind =
  | 'browse'
  | 'checkout'
  | 'call'
  | 'retry'
  | 'event'
  | 'fail'
  | 'bot'
  | 'reject'
  | 'cache'
  | 'db';

export interface DlqMessage {
  id: number;
  orderId: number;
  error: string;
  attempts: number;
  fixable: boolean;
}

export interface LogLine {
  t: number;
  level: 'info' | 'warn' | 'bad' | 'good';
  text: string;
}

/** One customer the story follows through the shop. */
export type TrackStage = 'waiting' | 'seat' | 'payment' | 'saving' | 'done' | 'message' | 'gaveup';
export interface Tracked {
  name: string;
  kind: 'checkout' | 'myOrders';
  stage: TrackStage;
  start: number;
  since: number;
  finished: boolean;
}
