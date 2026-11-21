import { useEffect, useRef, useState } from 'react';
import type { Sim } from '../sim/engine';

/** Drives a simulation in real time. Returns a tick that changes ~8 times a second. */
export function useSimLoop(sim: Sim | null, playing: boolean, speed: number, onDone?: () => void) {
  const [tick, setTick] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!sim) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(100, t - last));
      last = t;
      if (playing && !sim.done) {
        const c = sim.cfg;
        const load = c.browseRps + c.botRps + c.checkoutRps * 6 + c.myOrdersRps * 2 + c.accountRps * 3;
        sim.packetBudget = Math.min(1, 90 / Math.max(1, load * speed));
        sim.advance(dt * speed);
        if (sim.done) {
          setTick((x) => x + 1);
          doneRef.current?.();
        }
      }
      if (t - lastUi > 120) {
        lastUi = t;
        setTick((x) => x + 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim, playing, speed]);
  return tick;
}
