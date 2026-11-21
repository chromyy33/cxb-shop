// What the canvas shows for a given scenario and configuration.
import type { Sim } from '../sim/engine';
import type { SimConfig } from '../sim/types';

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';
export interface NodeState {
  line: string;
  bar?: number;
  tone: Tone;
  badge?: { text: string; tone: Tone };
}

export function visibleNodes(base: string[], cfg: SimConfig): Set<string> {
  const v = new Set(base);
  if (cfg.architecture === 'monolith') {
    v.delete('order');
    v.delete('product');
    v.add('monolith');
  } else v.delete('monolith');
  if (cfg.gateway) {
    if (base.includes('web') || base.includes('mobile')) v.add('gateway');
  } else v.delete('gateway');
  const messaging = base.includes('broker') || base.includes('invWorkers') || base.includes('notifWorkers') || base.includes('outbox');
  if (cfg.postOrder === 'outbox' && v.has('order') && messaging) {
    v.add('outbox');
    v.add('relay');
    v.add('broker');
  } else {
    v.delete('outbox');
    v.delete('relay');
  }
  if (cfg.postOrder === 'sync' && cfg.architecture === 'services') {
    v.delete('broker');
    v.delete('invWorkers');
    v.delete('notifWorkers');
    if (messaging) {
      v.add('email');
      v.add('shipping');
    }
  } else if (messaging && cfg.architecture === 'services') {
    v.add('broker');
    v.add('invWorkers');
    v.add('notifWorkers');
    v.add('email');
  }
  if (cfg.cache && (v.has('product') || base.includes('cache'))) v.add('cache');
  else v.delete('cache');
  if (cfg.dlq && v.has('invWorkers')) v.add('dlq');
  else v.delete('dlq');
  if (cfg.myOrdersMode === 'readModel' && (base.includes('readModel') || base.includes('shipping'))) v.add('readModel');
  else v.delete('readModel');
  return v;
}

export interface Wire {
  id: string;
  source: string;
  target: string;
  route: 'request' | 'call' | 'event' | 'data' | 'external' | 'risky';
}

const W = (source: string, target: string, route: Wire['route']): Wire => ({ id: `${source}-${target}`, source, target, route });

export function wires(vis: Set<string>, cfg: SimConfig): Wire[] {
  const all: Wire[] = [];
  const has = (...ids: string[]) => ids.every((i) => vis.has(i));
  const clients = ['web', 'mobile', 'bot'].filter((c) => vis.has(c));
  const front = vis.has('gateway') ? 'gateway' : null;
  for (const c of clients) {
    if (front) all.push(W(c, front, 'request'));
    else for (const t of ['order', 'product', 'monolith']) if (vis.has(t) && !(c === 'bot' && t === 'order')) all.push(W(c, t, 'request'));
  }
  if (front) for (const t of ['product', 'order', 'monolith', 'readModel']) if (vis.has(t)) all.push(W(front, t, 'request'));
  if (cfg.accountRps > 0) {
    const from = cfg.accountMode === 'aggregate' && front ? front : 'mobile';
    for (const t of ['payment', 'recs']) if (has(from, t)) all.push(W(from, t, 'request'));
    if (from === 'mobile' && has('mobile', 'order') && front) all.push(W('mobile', 'order', 'request'));
  }
  if (has('admin', 'productDb')) all.push(W('admin', 'productDb', 'data'));
  if (has('product', 'cache')) all.push(W('product', 'cache', 'data'));
  if (has('product', 'productDb')) all.push(W('product', 'productDb', 'data'));
  if (has('cache', 'productDb')) all.push(W('cache', 'productDb', 'data'));
  for (const t of ['productDb', 'orderDb', 'payment']) if (has('monolith', t)) all.push(W('monolith', t, t === 'payment' ? 'call' : 'data'));
  if (has('monolith', 'broker')) all.push(W('monolith', 'broker', 'event'));
  if (has('order', 'orderDb')) all.push(W('order', 'orderDb', 'data'));
  for (const t of ['payment', 'inventory', 'recs', 'shipping']) if (has('order', t)) all.push(W('order', t, 'call'));
  if (has('payment', 'payco')) all.push(W('payment', 'payco', 'external'));
  if (cfg.postOrder === 'sync' && has('order', 'email')) all.push(W('order', 'email', 'call'));
  if (cfg.postOrder === 'events' && has('order', 'broker')) all.push(W('order', 'broker', 'event'));
  if (has('order', 'outbox')) all.push(W('order', 'outbox', 'data'));
  if (has('outbox', 'relay')) all.push(W('outbox', 'relay', 'event'));
  if (has('relay', 'broker')) all.push(W('relay', 'broker', 'event'));
  for (const t of ['invWorkers', 'notifWorkers', 'readModel']) if (has('broker', t)) all.push(W('broker', t, 'event'));
  if (has('invWorkers', 'inventory')) all.push(W('invWorkers', 'inventory', 'call'));
  if (has('invWorkers', 'dlq')) all.push(W('invWorkers', 'dlq', 'event'));
  if (has('notifWorkers', 'email')) all.push(W('notifWorkers', 'email', 'external'));
  if (cfg.checkoutPriceFromCache && has('order', 'cache')) all.push(W('order', 'cache', 'risky'));
  return all;
}

export function nodeState(id: string, sim: Sim): NodeState {
  const r = sim.readout();
  const last = sim.history[sim.history.length - 1];
  const c = sim.cfg;
  const dep = (name: keyof typeof r.deps): Tone => (r.deps[name] === 'up' ? 'ok' : r.deps[name] === 'slow' ? 'warn' : 'bad');
  const depLine = (name: keyof typeof r.deps) => ({ up: 'healthy', slow: 'slow', down: 'down', flaky: 'failing' })[r.deps[name]];
  const threadTone = (u: number, w: number): Tone => (w > 0 || u > 0.95 ? 'bad' : u > 0.75 ? 'warn' : 'ok');
  switch (id) {
    case 'admin':
      return { line: 'staff change prices here', tone: 'idle' };
    case 'web':
      return { line: `${c.browseRps} views/s`, tone: 'idle' };
    case 'mobile':
      return { line: `${c.checkoutRps} checkouts/s`, tone: 'idle' };
    case 'bot':
      return { line: c.botRps ? `${c.botRps * 60} requests/min` : 'idle', tone: c.botRps ? 'bad' : 'idle' };
    case 'gateway': {
      const r429 = last?.rejected429 ?? 0;
      return { line: `${c.gatewayCopies} copies`, tone: r429 > 0 ? 'warn' : 'ok', badge: r429 > 0 ? { text: `${r429} × 429/s`, tone: 'warn' } : undefined };
    }
    case 'order':
    case 'monolith': {
      const u = r.orderThreads / Math.max(1, r.orderMax);
      return { line: `threads ${r.orderThreads}/${r.orderMax}${r.orderWaiting ? ` · ${r.orderWaiting} waiting` : ''}`, bar: u, tone: threadTone(u, r.orderWaiting) };
    }
    case 'product': {
      const u = r.productThreads / Math.max(1, r.productMax);
      return { line: `threads ${r.productThreads}/${r.productMax}`, bar: u, tone: threadTone(u, 0) };
    }
    case 'productDb':
      return { line: `conns ${r.dbUsed}/10${r.dbWaiting ? ` · ${r.dbWaiting} waiting` : ''}`, bar: r.dbUsed / 10, tone: r.dbWaiting > 8 ? 'bad' : r.dbWaiting > 0 ? 'warn' : 'ok' };
    case 'cache': {
      if (!last) return { line: `warming up · ttl ${c.cacheTtlSec}s`, tone: 'idle' };
      const hr = last.hitRate;
      return { line: `${Math.round(hr * 100)}% hits · ttl ${c.cacheTtlSec}s`, bar: hr, tone: hr > 0.8 ? 'ok' : hr > 0.5 ? 'warn' : 'bad' };
    }
    case 'orderDb':
      return { line: 'orders', tone: 'ok' };
    case 'outbox': {
      const age = last?.outboxAge ?? 0;
      return { line: `${r.outbox} unsent · oldest ${age.toFixed(0)}s`, tone: age > 8 ? 'bad' : r.outbox > 20 ? 'warn' : 'ok' };
    }
    case 'relay':
      return { line: `${c.relayMode === 'polling' ? 'polls every 1s' : 'tails the log'}`, tone: 'ok', badge: { text: 'process running', tone: 'ok' } };
    case 'payment': {
      const b = r.breakers.payment;
      return {
        line: `${depLine('payment')} · ${r.inflight.payment ?? 0} in flight`,
        tone: dep('payment'),
        badge: c.pay.breaker ? { text: `breaker ${b === 'half' ? 'half-open' : b}`, tone: b === 'closed' ? 'ok' : b === 'open' ? 'bad' : 'warn' } : undefined,
      };
    }
    case 'payco':
      return { line: depLine('payment'), tone: dep('payment') };
    case 'inventory':
      return { line: r.deps.invReserve === 'down' ? 'crashed' : depLine('inventory'), tone: r.deps.invReserve === 'down' ? 'bad' : dep('inventory') };
    case 'recs':
      return {
        line: `${depLine('recs')} · ${r.inflight.recs ?? 0} waiting`,
        bar: c.recs.bulkhead ? (r.inflight.recs ?? 0) / c.recs.bulkhead : undefined,
        tone: dep('recs'),
      };
    case 'shipping':
      return { line: sim.env.shippingHang ? 'not replying' : depLine('shipping'), tone: sim.env.shippingHang ? 'bad' : dep('shipping') };
    case 'email':
      return { line: depLine('email'), tone: dep('email') };
    case 'broker':
      return { line: depLine('broker'), tone: dep('broker') };
    case 'invWorkers': {
      const age = last?.oldestMsgSec ?? 0;
      return {
        line: `${r.workers} workers · ${r.invDepth} queued`,
        bar: Math.min(1, r.invDepth / 500),
        tone: r.invBusy > 12 || age > 15 ? 'bad' : r.invDepth > 50 ? 'warn' : 'ok',
        badge: age > 3 ? { text: `oldest ${age.toFixed(0)}s`, tone: age > 15 ? 'bad' : 'warn' } : undefined,
      };
    }
    case 'notifWorkers':
      return { line: `${r.notifDepth} emails queued`, bar: Math.min(1, r.notifDepth / 300), tone: r.notifDepth > 50 ? 'warn' : 'ok' };
    case 'dlq':
      return { line: `${r.dlq} waiting for a person`, tone: r.dlq > 0 ? 'warn' : 'ok' };
    case 'readModel':
      return { line: 'one record per order', tone: 'ok' };
  }
  return { line: '', tone: 'idle' };
}
