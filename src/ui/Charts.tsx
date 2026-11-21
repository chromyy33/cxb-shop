import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartKey } from '../content/scenarios';
import type { Snapshot } from '../sim/types';

interface Series {
  key: keyof Snapshot;
  name: string;
  color: string;
}
interface ChartDef {
  title: string;
  unit?: string;
  series: Series[];
  stacked?: boolean;
  max?: number;
}

const C = { good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)', info: 'var(--info)', violet: 'var(--violet)' };

export const CHARTS: Record<ChartKey, ChartDef> = {
  checkout: {
    title: 'Checkouts per second',
    stacked: true,
    series: [
      { key: 'checkoutOk', name: 'succeeded', color: C.good },
      { key: 'checkoutFail', name: 'failed', color: C.bad },
    ],
  },
  threads: { title: 'Order service threads in use', series: [{ key: 'orderThreads', name: 'busy threads', color: C.warn }] },
  payRps: { title: 'Calls to the payment company / s', series: [{ key: 'payRps', name: 'payment calls', color: C.warn }] },
  queue: {
    title: 'Inventory queue',
    series: [
      { key: 'invDepth', name: 'messages waiting', color: C.violet },
      { key: 'oldestMsgSec', name: 'oldest wait (s)', color: C.bad },
    ],
  },
  browse: { title: 'Product page time (p95)', unit: 'ms', series: [{ key: 'p95Browse', name: 'p95 ms', color: C.info }] },
  hitRate: { title: 'Cache hit rate', unit: '%', max: 1, series: [{ key: 'hitRate', name: 'hit rate', color: C.good }] },
  db: { title: 'Queries waiting on the product DB', series: [{ key: 'dbWaiting', name: 'waiting', color: C.bad }] },
  outbox: {
    title: 'Outbox',
    series: [
      { key: 'outboxAge', name: 'oldest unsent (s)', color: C.bad },
      { key: 'outbox', name: 'unsent rows', color: C.violet },
    ],
  },
  r429: { title: '429 Too Many Requests / s', series: [{ key: 'rejected429', name: '429s', color: C.warn }] },
  happiness: { title: 'Customer happiness', max: 100, series: [{ key: 'happiness', name: 'happiness', color: C.good }] },
  myOrders: { title: '“My orders” page time (p95)', unit: 'ms', series: [{ key: 'p95MyOrders', name: 'p95 ms', color: C.info }] },
};

export function MiniChart({ k, data }: { k: ChartKey; data: Snapshot[] }) {
  const def = CHARTS[k];
  const rows = data.slice(-60);
  const last = rows[rows.length - 1];
  const fmt = (v: number) => (def.unit === '%' ? `${Math.round(v * 100)}%` : def.unit === 'ms' ? `${Math.round(v)}ms` : `${Math.round(v * 10) / 10}`);
  return (
    <div className="chart">
      <div className="chart-head">
        <span>{def.title}</span>
        <span className="chart-now">{last ? def.series.map((s) => fmt(Number(last[s.key]))).join(' · ') : '—'}</span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--grid-strong)" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={30} unit="s" />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              domain={[0, def.max ?? 'auto']}
              tickFormatter={(v: number) => (def.unit === '%' ? `${Math.round(v * 100)}` : `${v}`)}
              width={44}
            />
            <Tooltip
              contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--muted)' }}
              labelFormatter={(t) => `t = ${t}s`}
              formatter={(v: number) => fmt(v)}
            />
            {def.series.map((s) => (
              <Area
                key={String(s.key)}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.18}
                strokeWidth={1.6}
                stackId={def.stacked ? 'a' : undefined}
                isAnimationActive={false}
                dot={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
