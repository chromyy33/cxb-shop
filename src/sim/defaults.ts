import type { CallPolicy, SimConfig } from './types';

export const basePolicy = (p: Partial<CallPolicy> = {}): CallPolicy => ({
  timeoutMs: 2000,
  retries: 0,
  backoffMs: 0,
  jitter: false,
  idempotencyKey: false,
  breaker: false,
  breakerThreshold: 0.5,
  breakerOpenMs: 5000,
  bulkhead: 0,
  fallback: 'message',
  ...p,
});

/** A healthy, sensibly built shop. Scenarios break parts of it on purpose. */
export const defaultConfig = (): SimConfig => ({
  browseRps: 60,
  checkoutRps: 12,
  myOrdersRps: 6,
  accountRps: 0,
  botRps: 0,
  mobileShare: 0.5,
  signalDrop: 0,
  cancelShare: 0,

  architecture: 'services',
  monolithCopies: 2,
  orderInstances: 2,
  orderThreads: 100,
  productInstances: 2,
  productThreads: 100,

  gateway: true,
  gatewayCopies: 3,
  rateLimit: 0,
  rateLimitBurst: 20,
  rateLimitShared: true,
  accountMode: 'aggregate',
  aggTimeoutMs: 800,

  postOrder: 'outbox',
  relayMode: 'polling',
  serverIdempotency: true,

  invWorkers: 3,
  autoscale: false,
  autoscaleMax: 10,
  idempotentHandlers: true,
  uniqueConstraint: true,
  partitionKey: true,
  maxDeliveries: 5,
  dlq: true,

  pay: basePolicy({ idempotencyKey: true }),
  inv: basePolicy({ timeoutMs: 1000 }),
  recs: basePolicy({ timeoutMs: 500, fallback: 'omit' }),
  notif: basePolicy({ timeoutMs: 1000 }),
  retryLayers: 1,

  cache: true,
  cacheTtlSec: 60,
  ttlJitter: true,
  coalescing: true,
  earlyRefresh: false,
  invalidateOnWrite: true,
  adminInvalidates: true,
  checkoutPriceFromCache: false,

  sagaCompensate: true,
  sagaOrder: 'reserve>book>capture',
  sagaStepTimeout: true,

  myOrdersMode: 'callThree',
  readYourWrites: true,

  alertOn: 'none',
});

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

export function mergeConfig(base: SimConfig, ...patches: (DeepPartial<SimConfig> | undefined)[]): SimConfig {
  const out = structuredClone(base) as SimConfig;
  for (const patch of patches) {
    if (!patch) continue;
    for (const [k, v] of Object.entries(patch)) {
      const key = k as keyof SimConfig;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        (out as unknown as Record<string, object>)[key] = { ...(out[key] as object), ...v };
      } else {
        (out as unknown as Record<string, unknown>)[key] = v;
      }
    }
  }
  return out;
}

/** Read or write a dotted path like "pay.timeoutMs". */
export function getPath(cfg: SimConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], cfg);
}

export function setPath(cfg: SimConfig, path: string, value: unknown): SimConfig {
  const next = structuredClone(cfg);
  const keys = path.split('.');
  let o = next as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
  return next;
}
