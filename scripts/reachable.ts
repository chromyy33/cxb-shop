// Every setting a scenario's solution changes must be reachable with the parts in its bin.
import { SCENARIOS } from '../src/content/scenarios';
import { scenarioConfig, solutionConfig } from '../src/sim/run';
import { PIECE_MAP, STEPPERS } from '../src/ui/pieces';
import { CONTROL_MAP } from '../src/content/controls';

const flat = (o: object, pre = ''): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(flat(v, `${pre}${k}.`)) : [[`${pre}${k}`, v]])));
let bad = 0;
for (const sc of SCENARIOS) {
  const a = flat(scenarioConfig(sc));
  const b = flat(solutionConfig(sc));
  const need = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const reach = new Set<string>();
  for (const t of sc.task.tools) {
    const p = PIECE_MAP[t];
    if (p) for (const target of p.targets) {
      const base = scenarioConfig(sc);
      for (const c of [p.add(base, target), p.remove?.(base, target)]) if (c) { const f = flat(c); Object.keys(f).forEach((k) => JSON.stringify(f[k]) !== JSON.stringify(a[k]) && reach.add(k)); }
      p.dials?.(target).forEach((d) => reach.add(CONTROL_MAP[d]?.path ?? d));
    }
    (STEPPERS[t] ?? []).forEach((s) => reach.add(s.path));
    if (t === 'sagaOrder') reach.add('sagaOrder');
  }
  const missing = need.filter((k) => !reach.has(k));
  if (missing.length) { bad++; console.log(`✗ ${sc.id}: can't reach ${missing.join(', ')}`); }
}
console.log(bad ? `${bad} scenario(s) unreachable` : 'Every solution is buildable from its parts bin.');
