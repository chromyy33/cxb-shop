import { Check, Gamepad2, Play } from 'lucide-react';
import { useState } from 'react';
import { MODULES, SCENARIOS } from '../content/scenarios';
import { defaultConfig } from '../sim/defaults';
import { Sim } from '../sim/engine';
import { Canvas } from './Canvas';
import { resetProgress } from './progress';
import { Footer, Header } from './Shell';
import { useSimLoop } from './useSimLoop';

const HERO_NODES = ['web', 'mobile', 'gateway', 'order', 'orderDb', 'payment', 'inventory'];

function LiveShop() {
  const [sim] = useState(() => new Sim({ ...defaultConfig(), browseRps: 30, checkoutRps: 8 }, 5));
  const tick = useSimLoop(sim, true, 1);
  return (
    <div className="home-map" aria-label="The shop running live: requests moving between services">
      <Canvas sim={sim} cfg={sim.cfg} baseNodes={HERO_NODES} tools={[]} editable={false} onChange={() => undefined} tick={tick} />
    </div>
  );
}

export function Home({ done, onOpen, onFree, onReset }: { done: Set<string>; onOpen: (id: string) => void; onFree: () => void; onReset: () => void }) {
  const total = SCENARIOS.length;
  const nextUp = SCENARIOS.find((s) => !done.has(s.id)) ?? SCENARIOS[0];

  return (
    <div className="page">
      <Header active="course" />
      <main className="home">
        <section className="intro">
          <div className="intro-copy">
            <h1>Learn system design by running a shoe shop</h1>
            <p>
              CXB Shop takes orders, charges cards and ships boxes. Each lesson asks one question, like what if payment gets slow, or what if a message arrives twice. You watch
              the shop go wrong, then fix it on the map with the pattern engineers use.
            </p>
            <div className="intro-actions">
              <button className="btn primary lg" onClick={() => onOpen(nextUp.id)}>
                <Play size={16} /> {done.size ? 'Continue' : 'Start the first lesson'}
              </button>
              <button className="btn lg" onClick={onFree}>
                <Gamepad2 size={16} /> Free play
              </button>
            </div>
            {done.size > 0 && (
              <p className="intro-progress">
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${(done.size / total) * 100}%` }} />
                </span>
                {done.size} of {total} lessons done. Next: {nextUp.title}{' '}
                <button
                  className="link"
                  onClick={() => {
                    resetProgress();
                    onReset();
                  }}
                >
                  Reset progress
                </button>
              </p>
            )}
          </div>
          <LiveShop />
        </section>

        <section className="syllabus" aria-labelledby="syllabus-h">
          <div className="syllabus-head">
            <h2 id="syllabus-h">Course</h2>
            <p>Four parts per lesson: see the shop, watch it break, fix it, learn why it works.</p>
          </div>
          {MODULES.map((m) => {
            const scs = SCENARIOS.filter((s) => s.module === m.n);
            const n = scs.filter((s) => done.has(s.id)).length;
            return (
              <div key={m.n} className="mod">
                <div className="mod-head">
                  <h3>
                    <span className="mod-n">Module {m.n}</span> {m.title}
                  </h3>
                  <p>{m.blurb}</p>
                  <span className="mod-count">
                    {n}/{scs.length}
                  </span>
                </div>
                <ol className="lesson-list">
                  {scs.map((s) => {
                    const isDone = done.has(s.id);
                    const isNext = s.id === nextUp.id;
                    return (
                      <li key={s.id}>
                        <button className={`lesson-row${isDone ? ' done' : ''}${isNext ? ' next' : ''}`} onClick={() => onOpen(s.id)}>
                          <span className="lesson-state" aria-label={isDone ? 'Done' : isNext ? 'Up next' : 'Not started'}>
                            {isDone ? <Check size={12} strokeWidth={3} /> : null}
                          </span>
                          <span className="lesson-title">{s.title}</span>
                          <span className="lesson-topic">{s.stepTitle}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
          <div className="mod free-row">
            <div className="mod-head">
              <h3>
                <span className="mod-n">After the course</span> Free play
              </h3>
              <p>The whole shop on one map. Set off outages and traffic spikes, or turn on chaos mode, and keep orders flowing with every pattern you’ve learned.</p>
            </div>
            <button className="btn" onClick={onFree}>
              <Gamepad2 size={16} /> Open free play
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
