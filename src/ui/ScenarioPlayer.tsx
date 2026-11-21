import { ArrowLeft, Check, CircleAlert, Eye, Lightbulb, Minus, Pause, Play, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { MODULES, SCENARIOS, type Scenario } from '../content/scenarios';
import type { Sim } from '../sim/engine';
import { createScenarioSim, scenarioConfig, solutionConfig } from '../sim/run';
import type { SimConfig } from '../sim/types';
import { Canvas, PACKET_LEGEND } from './Canvas';
import { MiniChart } from './Charts';
import { DlqInbox, LogFeed, Stats } from './Panels';
import { PIECES, STEPPERS } from './pieces';
import { NODE_MAP } from './layout';
import { markDone } from './progress';
import { NoteBox, WhatIf } from './Shell';
import { useSimLoop } from './useSimLoop';

type Mode = 'calm' | 'broken' | 'player' | 'solution';
const PARTS = ['The scenario', 'The problem', 'What you do', 'The solution'];
const SPEEDS = [1, 2, 4, 8];

export function ScenarioPlayer({ sc, onExit, onNext, done, initialPart = 0 }: { sc: Scenario; onExit: () => void; onNext: (id: string | null) => void; done: Set<string>; initialPart?: number }) {
  const initialMode: Mode = (['calm', 'broken', 'player', 'solution'] as const)[initialPart];
  const [part, setPart] = useState(initialPart);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [playerCfg, setPlayerCfg] = useState<SimConfig>(() => scenarioConfig(sc));
  const [sim, setSim] = useState<Sim>(() => makeSim(sc, initialMode, initialMode === 'solution' ? solutionConfig(sc) : scenarioConfig(sc)));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [finished, setFinished] = useState(false);
  const [hints, setHints] = useState(0);
  const [passed, setPassed] = useState(done.has(sc.id));
  const [lastResult, setLastResult] = useState<boolean[] | null>(null);

  const idx = SCENARIOS.findIndex((s) => s.id === sc.id);
  const next = SCENARIOS[idx + 1];
  const mod = MODULES[sc.module - 1];

  const start = useCallback(
    (m: Mode, cfg?: SimConfig) => {
      const c = m === 'solution' ? solutionConfig(sc) : m === 'player' ? (cfg ?? playerCfg) : scenarioConfig(sc);
      setSim(makeSim(sc, m, c));
      setMode(m);
      setFinished(false);
      setPlaying(true);
    },
    [sc, playerCfg],
  );

  const onDone = useCallback(() => {
    if (mode === 'calm') {
      setSim(makeSim(sc, 'calm', scenarioConfig(sc)));
      return;
    }
    setFinished(true);
    setPlaying(false);
    if (mode === 'player') {
      const res = sc.task.goals.map((g) => g.test(sim));
      setLastResult(res);
      if (res.every(Boolean)) {
        setPassed(true);
        markDone(sc.id);
      }
    }
  }, [mode, sc, sim]);

  const tick = useSimLoop(sim, playing, speed, onDone);

  const goPart = (p: number) => {
    setPart(p);
    if (p === 0) start('calm');
    if (p === 1) start('broken');
    if (p === 2 && mode !== 'player') start('player');
    if (p === 3) start('solution');
  };

  const changeCfg = (c: SimConfig) => {
    setPlayerCfg(c);
    if (mode === 'player') sim.setConfig(structuredClone(c));
  };

  const progress = Math.min(1, sim.now / (sc.duration * 1000));
  const markers = sc.script.filter((s) => s.label);
  const canvasCfg = mode === 'player' ? playerCfg : sim.cfg;
  const won = !!lastResult && lastResult.every(Boolean);
  const usedParts = partsDiff(sc);

  return (
    <div className="player" style={{ ['--line' as string]: mod.color }}>
      <header className="topbar">
        <button className="btn ghost" onClick={onExit}>
          <ArrowLeft size={16} /> Course
        </button>
        <div className="crumbs">
          <span className="crumb-strong">Module {sc.module}</span>
          <span>{mod.title}</span>
          <span className="crumb-sep">/</span>
          <span>{sc.stepTitle}</span>
        </div>
        <nav className="parts" aria-label="Scenario parts">
          {PARTS.map((p, i) => (
            <button key={p} className={`part${i === part ? ' on' : ''}${i < part ? ' past' : ''}`} onClick={() => goPart(i)}>
              <span className="part-n">{i + 1}</span>
              {p}
            </button>
          ))}
        </nav>
      </header>

      <div className="player-body">
        <aside className="story">
          <h1 className="story-title">{sc.title}</h1>
          {passed && (
            <div className="done-chip">
              <Check size={13} /> Cleared
            </div>
          )}

          {part === 0 && (
            <section className="story-part">
              <p className="lead">{sc.scenario}</p>
              <p className="note">This is the shop on a normal day. Drag the stations around if you like. Dots are requests and messages moving along the lines.</p>
              <button className="btn primary" onClick={() => goPart(1)}>
                Show me the problem
              </button>
            </section>
          )}

          {part === 1 && (
            <section className="story-part">
              <p className="question">{sc.problem.question}</p>
              {finished && mode === 'broken' ? (
                <p className="lead">{sc.problem.whatHappens}</p>
              ) : (
                <p className="note">Watch the map. The trouble starts at the orange mark on the timeline.</p>
              )}
              <GoalList sim={sim} sc={sc} final={finished && mode === 'broken'} />
              <button className="btn primary" onClick={() => goPart(2)}>
                Let me fix it
              </button>
            </section>
          )}

          {part === 2 && (
            <section className="story-part">
              <p className="lead">{sc.task.brief}</p>
              <div className="howto">
                {sc.task.tools.some((t) => PIECES.some((p) => p.id === t && p.inBin !== false)) && <span>Drag parts from the bin onto the map.</span>}
                {sc.task.tools.some((t) => t in STEPPERS) && (
                  <span>
                    Use <Minus size={11} /> <Plus size={11} /> on a station to scale it.
                  </span>
                )}
                <span>Click a part on the map to tune or remove it.</span>
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => start('player', playerCfg)}>
                  <Play size={16} /> Run the test
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const c = scenarioConfig(sc);
                    setPlayerCfg(c);
                    setLastResult(null);
                    start('player', c);
                  }}
                >
                  <RotateCcw size={15} /> Start over
                </button>
              </div>
              <GoalList sim={sim} sc={sc} final={finished && mode === 'player'} />
              {finished && mode === 'player' && lastResult && (
                <div className={`verdict ${won ? 'win' : 'lose'}`}>
                  {won ? (
                    <>
                      <Sparkles size={18} /> The shop held up.
                      <button className="btn primary sm" onClick={() => goPart(3)}>
                        See why it works
                      </button>
                    </>
                  ) : (
                    <>
                      <CircleAlert size={18} /> {lastResult.filter((x) => !x).length} goal{lastResult.filter((x) => !x).length > 1 ? 's' : ''} missed. Change the map and run it again.
                    </>
                  )}
                </div>
              )}
              <div className="hints">
                {sc.task.hints.slice(0, hints).map((h, i) => (
                  <p key={i} className="hint">
                    <Lightbulb size={14} /> {h}
                  </p>
                ))}
                <div className="row">
                  {hints < sc.task.hints.length && (
                    <button className="btn ghost sm" onClick={() => setHints((h) => h + 1)}>
                      <Lightbulb size={14} /> {hints ? 'Another hint' : 'Hint'}
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => goPart(3)}>
                    <Eye size={14} /> Show me the answer
                  </button>
                </div>
              </div>
            </section>
          )}

          {part === 3 && (
            <section className="story-part">
              <p className="lead">{sc.solution.summary}</p>
              {usedParts.length > 0 && (
                <div className="used">
                  {usedParts.map((u) => (
                    <span key={u.text} className={`used-chip ${u.kind}`}>
                      {u.kind === 'add' ? <Plus size={12} /> : u.kind === 'remove' ? <X size={12} /> : <Check size={12} />}
                      {u.text}
                    </span>
                  ))}
                </div>
              )}
              <dl className="facts">
                <div>
                  <dt>What it costs</dt>
                  <dd>{sc.solution.costs}</dd>
                </div>
                <div>
                  <dt>Common trap</dt>
                  <dd>{sc.solution.trap}</dd>
                </div>
                <div>
                  <dt>How would you know?</dt>
                  <dd>{sc.solution.signal}</dd>
                </div>
              </dl>
              <GoalList sim={sim} sc={sc} final={finished && mode === 'solution'} />
              <NoteBox id={sc.id} collapsible />
              <div className="row">
                {next ? (
                  <button className="btn primary" onClick={() => onNext(next.id)}>
                    Next: <WhatIf text={next.title} />
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => onNext(null)}>
                    Back to the course
                  </button>
                )}
              </div>
            </section>
          )}
        </aside>

        <main className="stage">
          <div className="simbar">
            <button className="btn icon" onClick={() => (sim.done ? start(mode) : setPlaying((p) => !p))} aria-label={playing && !sim.done ? 'Pause' : 'Play'}>
              {playing && !sim.done ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="btn icon" onClick={() => start(mode)} aria-label="Restart run">
              <RotateCcw size={16} />
            </button>
            <div className="speed" role="radiogroup" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)} role="radio" aria-checked={s === speed}>
                  {s}×
                </button>
              ))}
            </div>
            <div className="timeline" aria-label="Run progress">
              <div className="timeline-fill" style={{ width: `${progress * 100}%` }} />
              {markers.map((m) => (
                <span key={m.at} className="timeline-mark" style={{ left: `${(m.at / sc.duration) * 100}%` }} title={m.label} />
              ))}
            </div>
            <span className="mono small time">
              {(sim.now / 1000).toFixed(0)}s / {sc.duration}s
            </span>
            <span className={`mode-pill mode-${mode}`}>{{ calm: 'Normal day', broken: 'The problem', player: 'Your map', solution: 'Solution' }[mode]}</span>
          </div>
          <Canvas
            key={sc.id}
            sim={sim}
            cfg={canvasCfg}
            baseNodes={sc.nodes}
            tools={sc.task.tools}
            editable={part === 2}
            onChange={changeCfg}
            tick={tick}
            saga={!!sc.env?.saga}
          />
          <div className="legend">
            {PACKET_LEGEND.map(([k, l]) => (
              <span key={k}>
                <i className={`dot dot-${k}`} />
                {l}
              </span>
            ))}
          </div>
          <div className="dash">
            <section className="panel" aria-labelledby="feed-h">
              <h2 id="feed-h" className="panel-h">What’s happening</h2>
              <LogFeed lines={sim.log} />
              <DlqInbox sim={sim} />
            </section>
            <section className="panel" aria-labelledby="nums-h">
              <h2 id="nums-h" className="panel-h">Numbers</h2>
              <Stats sim={sim} keys={sc.stats} />
            </section>
          </div>
          <details className="charts-box">
            <summary>Charts over time</summary>
            <div className="charts">
              {sc.charts.map((k) => (
                <MiniChart key={k} k={k} data={sim.history} />
              ))}
            </div>
          </details>
        </main>
      </div>
    </div>
  );
}

function makeSim(sc: Scenario, mode: Mode, cfg: SimConfig) {
  if (mode === 'calm') return createScenarioSim({ ...sc, script: [], duration: 30 }, cfg);
  return createScenarioSim(sc, cfg);
}

/** Which parts the solution adds, removes or changes, in plain words. */
function partsDiff(sc: Scenario) {
  const a = scenarioConfig(sc);
  const b = solutionConfig(sc);
  const out: { kind: 'add' | 'remove' | 'tune'; text: string }[] = [];
  const where = (t: string) => {
    if (NODE_MAP[t]) return NODE_MAP[t].label;
    if (t === 'saga') return 'the saga';
    const [x, y] = t.split('-');
    return `${NODE_MAP[x]?.label} → ${NODE_MAP[y]?.label}`;
  };
  for (const p of PIECES) {
    if (!sc.task.tools.includes(p.id)) continue;
    for (const t of p.targets) {
      const before = p.isOn(a, t);
      const after = p.isOn(b, t);
      const label = p.kind === 'station' ? p.name : `${p.name} on ${where(t)}`;
      if (!before && after) out.push({ kind: 'add', text: label });
      else if (before && !after) out.push({ kind: 'remove', text: label });
      else if (after && p.label && p.label(a, t) !== p.label(b, t)) out.push({ kind: 'tune', text: `${p.name}: ${p.label(b, t)}` });
    }
  }
  for (const k of sc.task.tools.filter((t) => t in STEPPERS)) {
    for (const s of STEPPERS[k]) if (a[s.path] !== b[s.path]) out.push({ kind: 'tune', text: `${NODE_MAP[s.node].label}: ${b[s.path]} ${s.label}` });
  }
  if (a.sagaOrder !== b.sagaOrder) out.push({ kind: 'tune', text: `Saga order: ${b.sagaOrder.split('>').join(' → ')}` });
  return out;
}

function GoalList({ sim, sc, final }: { sim: Sim; sc: Scenario; final?: boolean }) {
  if (!sc.task.goals.length) return null;
  return (
    <div className="goals">
      <div className="goals-head">{final ? 'Result' : 'Goals, live'}</div>
      <ul>
        {sc.task.goals.map((g) => {
          const ok = g.test(sim);
          return (
            <li key={g.label} className={final ? (ok ? 'pass' : 'fail') : 'live'}>
              <span className="goal-icon">{final ? ok ? <Check size={13} /> : <X size={13} /> : <span className="pulse" />}</span>
              <span className="goal-label">{g.label}</span>
              <span className="goal-val mono">{g.value(sim)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
