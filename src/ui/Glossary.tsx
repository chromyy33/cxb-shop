import { Play } from 'lucide-react';
import { useState } from 'react';
import { TERMS, type Term } from '../content/glossary';
import { scenarioById } from '../content/scenarios';
import { defaultConfig, mergeConfig } from '../sim/defaults';
import { Sim } from '../sim/engine';
import { Canvas } from './Canvas';
import { Footer, Header, WhatIf } from './Shell';
import { useSimLoop } from './useSimLoop';

const GROUPS: Term['group'][] = ['Basics', 'Front door', 'Messages', 'Failures', 'Data'];

function build(t: Term) {
  const s = new Sim(mergeConfig(defaultConfig(), t.cfg), 11);
  Object.assign(s.env, t.env ?? {});
  const steps = t.incident
    ? [
        { at: t.incident.at, label: t.incident.label, run: t.incident.run },
        ...(t.incident.until && t.incident.undo ? [{ at: t.incident.until, run: t.incident.undo }] : []),
      ]
    : [];
  s.setScript(steps, 30);
  return s;
}

function LiveMap({ t }: { t: Term }) {
  const [sim, setSim] = useState(() => build(t));
  const tick = useSimLoop(sim, true, 1.5, () => window.setTimeout(() => setSim(build(t)), 1200));
  const last = sim.log[sim.log.length - 1];
  return (
    <div className="g-map">
      <div className="g-map-bar">
        <span>{t.incident ? (sim.now / 1000 < t.incident.at ? `In ${Math.ceil(t.incident.at - sim.now / 1000)}s: ${t.incident.label.toLowerCase()}` : last?.text ?? t.incident.label) : 'Live map, looping'}</span>
        <span className="g-map-time">{Math.floor(sim.now / 1000)}s</span>
      </div>
      <Canvas sim={sim} cfg={sim.cfg} baseNodes={t.nodes} tools={t.parts} editable={false} onChange={() => undefined} tick={tick} saga={!!t.env?.saga} />
    </div>
  );
}

export function Glossary({ selected, onSelect }: { selected?: string; onSelect: (id: string) => void }) {
  const t = TERMS.find((x) => x.id === selected) ?? TERMS[0];
  const lesson = t.scenario ? scenarioById(t.scenario) : undefined;
  return (
    <div className="page">
      <Header active="glossary" />
      <main className="glossary">
        <div className="page-head">
          <h1>Glossary</h1>
          <p className="muted">Every term in plain words, with a small version of the shop showing it at work.</p>
        </div>
        <div className="g-layout">
          <nav className="g-list" aria-label="Terms">
            {GROUPS.map((g) => (
              <div key={g} className="g-group">
                <h2>{g}</h2>
                {TERMS.filter((x) => x.group === g).map((x) => (
                  <button key={x.id} className={x.id === t.id ? 'on' : ''} onClick={() => onSelect(x.id)} aria-current={x.id === t.id ? 'true' : undefined}>
                    {x.term}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <article className="g-detail">
            <h2 className="g-term">{t.term}</h2>
            <p className="g-short">{t.short}</p>
            <p className="g-whatif">
              <WhatIf text={t.whatIf} />
            </p>
            <p className="g-more">{t.more}</p>
            <LiveMap key={t.id} t={t} />
            {lesson && (
              <a className="btn primary" href={`#s-${lesson.id}`}>
                <Play size={15} /> Try the lesson: <WhatIf text={lesson.title} />
              </a>
            )}
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
