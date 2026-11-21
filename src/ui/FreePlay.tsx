import { ArrowLeft, Flame, Pause, Play, RotateCcw, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultConfig } from '../sim/defaults';
import { Sim, hourlyCost } from '../sim/engine';
import type { SimConfig, Totals } from '../sim/types';
import { MiniChart } from './Charts';
import { ALL_NODE_IDS } from './layout';
import { Canvas, PACKET_LEGEND } from './Canvas';
import { DlqInbox, LogFeed, Stats } from './Panels';
import { useSimLoop } from './useSimLoop';

interface Incident {
  id: string;
  name: string;
  blurb: string;
  group: 'Traffic' | 'Failures' | 'Data & messages';
  secs: number;
  run: (sim: Sim) => () => void; // returns the undo
}

const INCIDENTS: Incident[] = [
  {
    id: 'drop',
    name: 'Sneaker drop',
    blurb: 'Checkouts ×4 for 30s',
    group: 'Traffic',
    secs: 30,
    run: (s) => {
      const was = s.cfg.checkoutRps;
      s.cfg.checkoutRps = was * 4;
      return () => (s.cfg.checkoutRps = was);
    },
  },
  {
    id: 'flash',
    name: 'Flash sale',
    blurb: 'Product page views ×3 for 30s',
    group: 'Traffic',
    secs: 30,
    run: (s) => {
      const was = s.cfg.browseRps;
      s.cfg.browseRps = was * 3;
      return () => (s.cfg.browseRps = was);
    },
  },
  {
    id: 'bot',
    name: 'Scraper bot',
    blurb: '3,000 requests a minute for 40s',
    group: 'Traffic',
    secs: 40,
    run: (s) => {
      s.cfg.botRps = 50;
      return () => (s.cfg.botRps = 0);
    },
  },
  {
    id: 'pslow',
    name: 'Payment slow',
    blurb: '30s per answer for 25s',
    group: 'Failures',
    secs: 25,
    run: (s) => {
      s.setDep('payment', 'slow');
      return () => s.setDep('payment', 'up');
    },
  },
  {
    id: 'pdown',
    name: 'Payment down',
    blurb: 'No answers for 30s',
    group: 'Failures',
    secs: 30,
    run: (s) => {
      s.setDep('payment', 'down');
      return () => s.setDep('payment', 'up');
    },
  },
  {
    id: 'pblip',
    name: 'Payment blip',
    blurb: 'Every call fails for 3s',
    group: 'Failures',
    secs: 3,
    run: (s) => {
      s.setDep('payment', 'flaky');
      return () => s.setDep('payment', 'up');
    },
  },
  {
    id: 'rslow',
    name: 'Recommendations slow',
    blurb: '1.8s per answer for 30s',
    group: 'Failures',
    secs: 30,
    run: (s) => {
      s.setDep('recs', 'slow');
      return () => s.setDep('recs', 'up');
    },
  },
  {
    id: 'email',
    name: 'Email company down',
    blurb: 'For 25s',
    group: 'Failures',
    secs: 25,
    run: (s) => {
      s.setDep('email', 'down');
      return () => s.setDep('email', 'up');
    },
  },
  {
    id: 'broker',
    name: 'Broker outage',
    blurb: 'For 10s',
    group: 'Failures',
    secs: 10,
    run: (s) => {
      s.setDep('broker', 'down');
      return () => s.setDep('broker', 'up');
    },
  },
  {
    id: 'ship',
    name: 'Shipping goes silent',
    blurb: 'Stops replying for 20s',
    group: 'Failures',
    secs: 20,
    run: (s) => {
      s.env.shippingHang = true;
      s.setDep('shipping', 'slow');
      return () => {
        s.env.shippingHang = false;
        s.setDep('shipping', 'up');
      };
    },
  },
  {
    id: 'relay',
    name: 'Relay loses the broker',
    blurb: 'Looks alive, sends nothing',
    group: 'Data & messages',
    secs: 30,
    run: (s) => {
      s.env.relayStuck = true;
      s.say('warn', 'The relay quietly lost its connection to the broker.');
      return () => (s.env.relayStuck = false);
    },
  },
  {
    id: 'poison',
    name: 'Old app sends bad IDs',
    blurb: '4% poison messages for 30s',
    group: 'Data & messages',
    secs: 30,
    run: (s) => {
      s.env.poisonShare = 0.04;
      return () => (s.env.poisonShare = 0);
    },
  },
  {
    id: 'price',
    name: 'Admin changes a price',
    blurb: 'Through the old admin tool',
    group: 'Data & messages',
    secs: 1,
    run: (s) => {
      s.changePrice('admin');
      return () => undefined;
    },
  },
  {
    id: 'signal',
    name: 'Weak signals everywhere',
    blurb: '15% of phone replies lost for 30s',
    group: 'Data & messages',
    secs: 30,
    run: (s) => {
      s.cfg.signalDrop = 0.15;
      return () => (s.cfg.signalDrop = 0);
    },
  },
  {
    id: 'expire',
    name: 'Bulk cache preload',
    blurb: 'Every product cached at once',
    group: 'Data & messages',
    secs: 1,
    run: (s) => {
      s.preloadCache();
      s.say('info', 'Every product was loaded into the cache at the same moment.');
      return () => undefined;
    },
  },
];

const BAD_KEYS: (keyof Totals)[] = [
  'doubleCharges',
  'duplicateOrders',
  'unpaidOrders',
  'lostEvents',
  'doubleReserve',
  'ghostReservations',
  'lostMessages',
  'staleReads',
  'wrongPrice',
  'leakedStock',
  'stuckSagas',
];

function freshSim(cfg: SimConfig) {
  const s = new Sim(structuredClone(cfg), Math.floor(Math.random() * 1e6));
  Object.assign(s.env, { saga: true, captureFail: 0.03, bookFail: 0.01, workerCrash: 0.005, relayCrash: 0.005 });
  return s;
}

const freeDefaults = (): SimConfig => ({ ...defaultConfig(), accountRps: 4, cancelShare: 0.03 });

export function FreePlay({ onExit }: { onExit: () => void }) {
  const [cfg, setCfg] = useState<SimConfig>(freeDefaults);
  const [sim, setSim] = useState(() => freshSim(freeDefaults()));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [chaos, setChaos] = useState(false);
  const [active, setActive] = useState<{ id: string; until: number }[]>([]);
  const tick = useSimLoop(sim, playing, speed);
  const nextChaos = useRef(20000);

  const fire = (inc: Incident) => {
    const undo = inc.run(sim);
    sim.say('warn', `Incident: ${inc.name}.`);
    const until = sim.now + inc.secs * 1000;
    sim.after(inc.secs * 1000, () => {
      undo();
      setCfg(structuredClone(sim.cfg));
    });
    setActive((a) => [...a.filter((x) => x.until > sim.now), { id: inc.id, until }]);
    setCfg(structuredClone(sim.cfg));
  };

  // chaos mode: a random incident every 20–40 simulated seconds
  useEffect(() => {
    if (!chaos) return;
    if (sim.now >= nextChaos.current) {
      const pool = INCIDENTS.filter((i) => !active.some((a) => a.id === i.id && a.until > sim.now));
      fire(pool[Math.floor(Math.random() * pool.length)]);
      nextChaos.current = sim.now + 20000 + Math.random() * 20000;
    }
  });

  const change = (c: SimConfig) => {
    setCfg(c);
    sim.setConfig(structuredClone(c));
  };

  const t = sim.totals;
  const last = sim.history[sim.history.length - 1];
  const ordersMin = sim.history.slice(-10).reduce((a, h) => a + h.checkoutOk, 0) * 6;
  const profit = t.revenue - t.cost;
  const incidents = BAD_KEYS.reduce((a, k) => a + (t[k] as number), 0);
  const happiness = last?.happiness ?? 100;
  const grade = useMemo(() => {
    const score = happiness - Math.min(40, incidents / 4);
    return score > 92 ? 'A' : score > 82 ? 'B' : score > 70 ? 'C' : score > 55 ? 'D' : 'F';
  }, [happiness, incidents]);

  return (
    <div className="free">
      <header className="topbar">
        <button className="btn ghost" onClick={onExit}>
          <ArrowLeft size={16} /> Course
        </button>
        <div className="crumbs">
          <span className="crumb-strong">Free play</span>
          <span>You run CXB Shop</span>
        </div>
        <div className="hud">
          <div className="hud-cell">
            <span className="hud-l">Profit</span>
            <span className={`hud-v ${profit < 0 ? 'bad' : ''}`}>${Math.round(profit).toLocaleString()}</span>
          </div>
          <div className="hud-cell">
            <span className="hud-l">Orders/min</span>
            <span className="hud-v">{ordersMin.toLocaleString()}</span>
          </div>
          <div className="hud-cell">
            <span className="hud-l">Happiness</span>
            <span className={`hud-v ${happiness < 70 ? 'bad' : ''}`}>{happiness}%</span>
          </div>
          <div className="hud-cell">
            <span className="hud-l">Correctness slips</span>
            <span className={`hud-v ${incidents ? 'bad' : ''}`}>{incidents}</span>
          </div>
          <div className="hud-cell">
            <span className="hud-l">Servers</span>
            <span className="hud-v">${hourlyCost(cfg, sim.workers)}/h</span>
          </div>
          <div className={`grade grade-${grade}`} title="Shop rating">
            {grade}
          </div>
        </div>
      </header>

      <div className="free-body">
        <aside className="deck">
          <div className="deck-head">
            <h2 className="deck-title">Incidents</h2>
            <button className={`btn sm ${chaos ? 'danger' : 'ghost'}`} onClick={() => setChaos((c) => !c)} aria-pressed={chaos}>
              <Shuffle size={14} /> Chaos mode {chaos ? 'on' : 'off'}
            </button>
          </div>
          <p className="muted small">Trigger trouble yourself, or turn on chaos mode and keep the shop alive.</p>
          {(['Traffic', 'Failures', 'Data & messages'] as const).map((grp) => (
            <div key={grp} className="deck-group">
              <h3 className="deck-sub">{grp}</h3>
              {INCIDENTS.filter((i) => i.group === grp).map((i) => {
                const live = active.find((a) => a.id === i.id && a.until > sim.now);
                return (
                  <button key={i.id} className={`incident${live ? ' live' : ''}`} onClick={() => !live && fire(i)} disabled={!!live}>
                    <Flame size={14} />
                    <span>
                      <b>{i.name}</b>
                      <small>{live ? `${Math.ceil((live.until - sim.now) / 1000)}s left` : i.blurb}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <main className="stage">
          <div className="simbar">
            <button className="btn icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              className="btn icon"
              onClick={() => {
                setSim(freshSim(cfg));
                setActive([]);
                nextChaos.current = 20000;
              }}
              aria-label="Restart the shop"
            >
              <RotateCcw size={16} />
            </button>
            <div className="speed" role="radiogroup" aria-label="Speed">
              {[1, 2, 4].map((s) => (
                <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)} role="radio" aria-checked={s === speed}>
                  {s}×
                </button>
              ))}
            </div>
            <span className="mono small time">Day 1 · {fmtClock(sim.now)}</span>
            <div className="legend inline">
              {PACKET_LEGEND.map(([k, l]) => (
                <span key={k}>
                  <i className={`dot dot-${k}`} />
                  {l}
                </span>
              ))}
            </div>
          </div>
          <Canvas sim={sim} cfg={cfg} baseNodes={[...ALL_NODE_IDS, 'admin']} tools="all" editable onChange={change} tick={tick} saga />
          <div className="dash">
            <section className="panel" aria-labelledby="feed-h">
              <h2 id="feed-h" className="panel-h">What’s happening</h2>
              <LogFeed lines={sim.log} />
              <DlqInbox sim={sim} />
            </section>
            <section className="panel" aria-labelledby="nums-h">
              <h2 id="nums-h" className="panel-h">Numbers</h2>
              <Stats sim={sim} keys={['ordersPlaced', 'doubleCharges', 'lostEvents', 'doubleReserve', 'staleReads', 'stuckSagas']} />
            </section>
          </div>
          <details className="charts-box" open>
            <summary>Charts over time</summary>
            <div className="charts">
              {(['checkout', 'threads', 'payRps', 'queue', 'browse', 'db', 'outbox', 'happiness'] as const).map((k) => (
                <MiniChart key={k} k={k} data={sim.history} />
              ))}
            </div>
          </details>
        </main>

      </div>
    </div>
  );
}

function fmtClock(ms: number) {
  // one simulated second = one shop minute, starting at 9:00
  const mins = 9 * 60 + Math.floor(ms / 1000);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
