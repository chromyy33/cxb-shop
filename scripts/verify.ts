import { SCENARIOS } from '../src/content/scenarios';
import { runHeadless, scenarioConfig, solutionConfig } from '../src/sim/run';

const only = process.argv[2];
let bad = 0;
for (const sc of SCENARIOS) {
  if (only && !sc.id.includes(only)) continue;
  if (!sc.task.goals.length) { console.log(`· ${sc.id} (quiz only)`); continue; }
  const t0 = Date.now();
  const broken = runHeadless(sc, scenarioConfig(sc));
  const fixed = runHeadless(sc, solutionConfig(sc));
  const b = sc.task.goals.map((g) => [g.test(broken), g.value(broken)] as const);
  const f = sc.task.goals.map((g) => [g.test(fixed), g.value(fixed)] as const);
  const brokenFails = b.some(([ok]) => !ok);
  const fixedPasses = f.every(([ok]) => ok);
  const ok = brokenFails && fixedPasses;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${sc.id}  (${Date.now() - t0}ms)`);
  sc.task.goals.forEach((g, i) => console.log(`    ${g.label}\n      broken: ${b[i][0] ? 'pass' : 'FAIL'} ${b[i][1]}   solution: ${f[i][0] ? 'pass' : 'FAIL'} ${f[i][1]}`));
}
console.log(bad ? `\n${bad} scenario(s) need tuning` : '\nAll scenarios behave.');
