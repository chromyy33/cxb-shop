import { Footprints } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

/** Site header shared by the course, notes and glossary pages. */
export function Header({ active }: { active: 'course' | 'free' | 'notes' | 'glossary' }) {
  const links: [typeof active, string, string][] = [
    ['course', 'Course', '#'],
    ['free', 'Free play', '#free'],
    ['notes', 'Notes', '#notes'],
    ['glossary', 'Glossary', '#glossary'],
  ];
  return (
    <header className="site-head">
      <a className="brand" href="#">
        <span className="brand-tile">
          <Footprints size={16} strokeWidth={2.4} />
        </span>
        CXB Shop
      </a>
      <nav className="site-nav" aria-label="Main">
        {links.map(([id, label, href]) => (
          <a key={id} href={href} className={active === id ? 'on' : ''} aria-current={active === id ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

/** A lesson title. Kept as a component so the treatment stays consistent everywhere. */
export function WhatIf({ text }: { text: string }) {
  return <>{text}</>;
}

export function Title({ children, as: Tag = 'h1', className = '' }: { children: ReactNode; as?: 'h1' | 'h2'; className?: string }) {
  return <Tag className={`title ${className}`}>{children}</Tag>;
}

export function Footer() {
  return (
    <footer className="site-foot">
      <p>
        Based on the free course{' '}
        <a href="https://www.youtube.com/watch?v=TnoW2ZrzUWI" target="_blank" rel="noreferrer">
          System Design Architecture Patterns
        </a>
        . The shop, the scenarios and the look follow that course; the simulation is made for this game.
      </p>
    </footer>
  );
}

// ───────── personal notes, saved in this browser
const NOTES_KEY = 'cxb-notes-v1';
export function readNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
function writeNote(id: string, text: string) {
  try {
    const all = readNotes();
    if (text.trim()) all[id] = text;
    else delete all[id];
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function NoteBox({ id, label = 'Your notes', collapsible = false }: { id: string; label?: string; collapsible?: boolean }) {
  const [text, setText] = useState(() => readNotes()[id] ?? '');
  const [open, setOpen] = useState(!collapsible || !!text);
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((readNotes()[id] ?? '') === text) return;
      setState(writeNote(id, text) ? 'saved' : 'failed');
    }, 400);
    return () => window.clearTimeout(t);
  }, [id, text]);
  if (!open)
    return (
      <button className="btn sm ghost notebox-open" onClick={() => setOpen(true)}>
        Add a note
      </button>
    );
  return (
    <div className="notebox">
      <label htmlFor={`note-${id}`}>{label}</label>
      <textarea id={`note-${id}`} name={`note-${id}`} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="What clicked for you, in your own words…" rows={4} />
      <span className="notebox-state">{state === 'saved' ? 'Saved in this browser' : state === 'failed' ? 'This browser blocks saving, so notes last until you leave' : ''}</span>
    </div>
  );
}
