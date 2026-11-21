import { Info, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CONTROL_MAP, formatValue, type ControlDef } from '../content/controls';
import { getPath, setPath } from '../sim/defaults';
import type { Sim } from '../sim/engine';
import type { LogLine, SimConfig, Totals } from '../sim/types';

// ───────── counters

export const STAT_LABELS: Partial<Record<keyof Totals, { label: string; bad?: boolean; good?: boolean }>> = {
  checkoutOk: { label: 'Checkouts succeeded', good: true },
  checkoutErrorPage: { label: 'Error pages shown', bad: true },
  checkoutMessage: { label: '“Try again” messages' },
  checkoutFrozen: { label: 'Gave up waiting', bad: true },
  browseOk: { label: 'Product pages loaded', good: true },
  browseFrozen: { label: 'Product pages timed out', bad: true },
  myOrdersOk: { label: '“My orders” loaded', good: true },
  myOrdersFail: { label: '“My orders” failed', bad: true },
  missingOrder: { label: '“Where’s my order?”', bad: true },
  accountOk: { label: 'Account pages loaded', good: true },
  accountFail: { label: 'Account pages failed', bad: true },
  botPassed: { label: 'Bot requests served', bad: true },
  rejected429: { label: '429s sent to the bot' },
  payAttempts: { label: 'Payment calls made' },
  payFastFails: { label: 'Failed fast (breaker open)' },
  peakPayRps: { label: 'Peak payment calls/s', bad: true },
  doubleCharges: { label: 'Customers charged twice', bad: true },
  duplicateOrders: { label: 'Duplicate orders', bad: true },
  unpaidOrders: { label: 'Orders shipped unpaid', bad: true },
  lostEvents: { label: 'Orders never announced', bad: true },
  doubleReserve: { label: 'Stock reserved twice', bad: true },
  ghostReservations: { label: 'Reserved for cancelled orders', bad: true },
  dupRejected: { label: 'Duplicates safely skipped', good: true },
  poisonRetries: { label: 'Wasted tries on bad messages', bad: true },
  lostMessages: { label: 'Messages thrown away', bad: true },
  dlqIn: { label: 'Sent to dead letter queue' },
  staleReads: { label: 'Stale prices shown', bad: true },
  wrongPrice: { label: 'Charged a wrong price', bad: true },
  cacheHits: { label: 'Cache hits', good: true },
  dbQueries: { label: 'Database queries' },
  peakDbWaiting: { label: 'Peak queries waiting', bad: true },
  sagaConfirmed: { label: 'Orders confirmed', good: true },
  sagaCompensated: { label: 'Cleanly cancelled', good: true },
  leakedStock: { label: 'Pairs stuck reserved', bad: true },
  leakedDelivery: { label: 'Deliveries left booked', bad: true },
  chargedNoShoes: { label: 'Charged, no shoes', bad: true },
  refunds: { label: 'Refunds issued', bad: true },
  stuckSagas: { label: 'Orders stuck pending', bad: true },
  emailsSent: { label: 'Emails sent', good: true },
  ordersPlaced: { label: 'Orders placed', good: true },
  maxMsgAgeSec: { label: 'Longest wait in queue (s)', bad: true },
  dbOverloadSec: { label: 'Seconds DB overloaded', bad: true },
  invCrashes: { label: 'Inventory crashes', bad: true },
};

export function Stats({ sim, keys }: { sim: Sim; keys: (keyof Totals)[] }) {
  return (
    <div className="stats">
      {keys.map((k) => {
        const meta = STAT_LABELS[k] ?? { label: k };
        const v = Math.round(Number(sim.totals[k]));
        const tone = meta.bad && v > 0 ? 'bad' : meta.good && v > 0 ? 'good' : '';
        return (
          <div className={`stat ${tone}`} key={k}>
            <div className="stat-v">{v.toLocaleString()}</div>
            <div className="stat-l">{meta.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ───────── controls

function Control({ def, cfg, onChange, locked }: { def: ControlDef; cfg: SimConfig; onChange: (c: SimConfig) => void; locked?: boolean }) {
  const [tip, setTip] = useState(false);
  const v = getPath(cfg, def.path);
  const set = (nv: unknown) => onChange(setPath(cfg, def.path, nv));
  return (
    <div className={`ctl${locked ? ' locked' : ''}`}>
      <div className="ctl-head">
        <label htmlFor={`ctl-${def.key}`}>{def.label}</label>
        <button className="tip-btn" onClick={() => setTip((t) => !t)} aria-label={`What is ${def.label}?`} aria-expanded={tip}>
          <Info size={14} />
        </button>
        <span className="ctl-val">{formatValue(def, v)}</span>
      </div>
      {tip && <p className="ctl-tip">{def.tip}</p>}
      {def.kind === 'toggle' && (
        <button id={`ctl-${def.key}`} className={`toggle${v ? ' on' : ''}`} role="switch" aria-checked={!!v} disabled={locked} onClick={() => set(!v)}>
          <span className="knob" />
          <span>{v ? 'On' : 'Off'}</span>
        </button>
      )}
      {def.kind === 'slider' && (
        <input
          id={`ctl-${def.key}`}
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={Number(v)}
          disabled={locked}
          onChange={(e) => set(Number(e.target.value))}
        />
      )}
      {def.kind === 'select' && (
        <div className="seg" role="radiogroup" aria-label={def.label} id={`ctl-${def.key}`}>
          {def.options!.map((o) => (
            <button key={String(o.value)} role="radio" aria-checked={v === o.value} className={v === o.value ? 'on' : ''} disabled={locked} onClick={() => set(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ControlList({ keys, cfg, onChange, locked }: { keys: string[]; cfg: SimConfig; onChange: (c: SimConfig) => void; locked?: boolean }) {
  return (
    <div className="ctl-list">
      {keys.map((k) => {
        const def = CONTROL_MAP[k];
        return def ? <Control key={k} def={def} cfg={cfg} onChange={onChange} locked={locked} /> : null;
      })}
    </div>
  );
}

// ───────── event log

export function LogFeed({ lines }: { lines: LogLine[] }) {
  const shown = lines.slice(-7).reverse();
  return (
    <ol className="log" aria-live="polite">
      {shown.length === 0 && <li className="log-empty">All quiet. When something changes in the shop, it shows up here.</li>}
      {shown.map((l, i) => (
        <li key={`${l.t}-${i}`} className={`log-${l.level}`}>
          <span className="log-t">{(l.t / 1000).toFixed(0)}s</span>
          {l.text}
        </li>
      ))}
    </ol>
  );
}

// ───────── dead letter inbox

export function DlqInbox({ sim }: { sim: Sim }) {
  if (!sim.dlq.length) return null;
  return (
    <div className="dlq">
      <div className="dlq-head">
        Dead letter inbox <span className="pill warn">{sim.dlq.length}</span>
      </div>
      <p className="muted small">Each message is an order the shop couldn’t finish. Read the error, then fix and replay it, or discard it and write down why.</p>
      <ul>
        {sim.dlq.slice(0, 4).map((d) => (
          <li key={d.id}>
            <div>
              <b>Order #{d.orderId}</b> · {d.attempts} tries
              <div className="mono small">{d.error}</div>
            </div>
            <div className="dlq-actions">
              <button className="btn tiny" onClick={() => sim.replayDlq(d.id, 'replay')}>
                <RotateCcw size={13} /> Fix &amp; replay
              </button>
              <button className="btn tiny ghost" onClick={() => sim.replayDlq(d.id, 'discard')} aria-label="Discard">
                <Trash2 size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
