import { Copy } from 'lucide-react';
import { useState } from 'react';
import { MODULES, SCENARIOS } from '../content/scenarios';
import { Footer, Header, NoteBox, WhatIf, readNotes } from './Shell';

export function Notes() {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copyAll = async () => {
    const mine = readNotes();
    const text = SCENARIOS.map((s) => {
      const own = mine[s.id] ? `\nMy notes: ${mine[s.id]}` : '';
      return `${s.title}\nFix: ${s.solution.summary}\nCost: ${s.solution.costs}\nTrap: ${s.solution.trap}\nHow you'd notice: ${s.solution.signal}${own}`;
    }).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };
  return (
    <div className="page">
      <Header active="notes" />
      <main className="notes">
        <div className="page-head">
          <h1>Study notes</h1>
          <p className="muted">
            The fix, the cost, the trap and the warning sign for every lesson. Add your own notes as you go; they stay in this browser.
          </p>
          <button className="btn" onClick={copyAll}>
            <Copy size={15} /> {copied === 'ok' ? 'Copied all notes' : copied === 'fail' ? 'Copy blocked by the browser' : 'Copy all notes'}
          </button>
        </div>
        {MODULES.map((m) => (
          <section key={m.n} className="notes-mod">
            <h2 className="notes-mod-title">
              <span className="mod-n">Module {m.n}</span> {m.title}
            </h2>
            <div className="notes-list">
              {SCENARIOS.filter((s) => s.module === m.n).map((s) => (
                <article key={s.id} className="note-card">
                  <h3>
                    <WhatIf text={s.title} />
                  </h3>
                  <p className="note-step">{s.stepTitle}</p>
                  <dl>
                    <dt>The fix</dt>
                    <dd>{s.solution.summary}</dd>
                    <dt>What it costs</dt>
                    <dd>{s.solution.costs}</dd>
                    <dt>The trap</dt>
                    <dd>{s.solution.trap}</dd>
                    <dt>How you’d notice</dt>
                    <dd>{s.solution.signal}</dd>
                  </dl>
                  <NoteBox id={s.id} collapsible />
                  <a className="text-link" href={`#s-${s.id}`}>
                    Open the lesson
                  </a>
                </article>
              ))}
            </div>
          </section>
        ))}
      </main>
      <Footer />
    </div>
  );
}
