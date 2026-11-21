import { useEffect, useState } from 'react';
import { scenarioById } from './content/scenarios';
import { FreePlay } from './ui/FreePlay';
import { Glossary } from './ui/Glossary';
import { Notes } from './ui/Notes';
import { Home } from './ui/Home';
import { loadDone } from './ui/progress';
import { ScenarioPlayer } from './ui/ScenarioPlayer';

const readHash = () => window.location.hash.replace(/^#/, '');

export default function App() {
  const [route, setRoute] = useState(readHash);
  const [done, setDone] = useState(loadDone);

  useEffect(() => {
    const on = () => {
      setRoute(readHash());
      setDone(loadDone());
      if (!readHash().startsWith('g-')) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = (r: string) => {
    window.location.hash = r;
  };

  if (route === 'free') return <FreePlay onExit={() => go('')} />;
  if (route === 'notes') return <Notes />;
  if (route === 'glossary' || route.startsWith('g-')) return <Glossary selected={route.startsWith('g-') ? route.slice(2) : undefined} onSelect={(id) => go(`g-${id}`)} />;
  const [sid, partStr] = route.slice(2).split('@');
  const sc = route.startsWith('s-') ? scenarioById(sid) : undefined;
  const part = Math.max(1, Math.min(4, Number(partStr) || 1)) - 1;
  if (sc) return <ScenarioPlayer key={sc.id} sc={sc} done={done} initialPart={part} onExit={() => go('')} onNext={(id) => go(id ? `s-${id}` : '')} />;
  return <Home done={done} onOpen={(id) => go(`s-${id}`)} onFree={() => go('free')} onReset={() => setDone(new Set())} />;
}
