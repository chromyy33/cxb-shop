import type { Scenario } from '../content/scenarios';
import { defaultConfig, mergeConfig } from './defaults';
import { Sim } from './engine';
import type { SimConfig } from './types';

export const scenarioConfig = (sc: Scenario): SimConfig => mergeConfig(defaultConfig(), sc.base);
export const solutionConfig = (sc: Scenario): SimConfig => mergeConfig(defaultConfig(), sc.base, sc.solution.fix);

/** Build a fresh simulation for a scenario with the given player config. */
export function createScenarioSim(sc: Scenario, cfg: SimConfig, seed = 7): Sim {
  const sim = new Sim(structuredClone(cfg), seed);
  Object.assign(sim.env, sc.env ?? {});
  sc.setup?.(sim);
  sim.setScript(sc.script, sc.duration);
  return sim;
}

export function runHeadless(sc: Scenario, cfg: SimConfig, seed = 7) {
  const sim = createScenarioSim(sc, cfg, seed);
  while (!sim.done) sim.advance(100);
  return sim;
}
