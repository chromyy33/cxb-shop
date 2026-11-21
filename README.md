# CXB Shop: a system design game

Learn system design architecture patterns by running a simulated online shoe shop.
Every lesson starts with a question (what if payment gets slow? what if a message arrives
twice?), shows it going wrong on a live map, and lets you fix it by dropping the right
pattern onto the map.

Based on the free course
[System Design Architecture Patterns](https://www.youtube.com/watch?v=TnoW2ZrzUWI).
The shop, the scenarios and the visual style follow that course; the simulation and the
game are built for this project.

## What's inside

- **Course:** 4 modules, 26 lessons. Each has four parts: the scenario, the problem,
  what you do, and the solution.
- **Free play:** the whole shop on one map. Trigger outages, traffic spikes and scraper
  bots, or turn on chaos mode.
- **Notes:** a study card for every lesson, plus your own notes (saved in your browser).
- **Glossary:** every term in plain words, each with a small live map.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run verify   # every lesson fails when broken, passes with its solution,
                 # and every solution can be built from that lesson's parts
npm run build    # static site in dist/
```

Deploys to Netlify as-is (`netlify.toml` is included).

## How it's built

```
src/
  sim/              the simulation (no UI): requests, threads, calls with timeout/retry/
                    breaker/bulkhead, queues and workers, outbox, idempotency, DLQ,
                    cache, rate limit, saga, CQRS
  content/
    scenarios.ts    the 26 lessons: text, starting setup, incidents, goals, hints,
                    the parts each lesson offers (task.tools), and the solution
    glossary.ts     glossary terms and the small map each one shows
    controls.ts     the dials a placed part exposes, with plain-language tips
  ui/
    Canvas.tsx      the interactive map (React Flow): draggable stations, parts bin,
                    inspector, saga strip, live traffic
    pieces.ts       every pattern as a part: where it can go and what it changes
    ScenarioPlayer  the four-part lesson
    FreePlay.tsx    free play
    Home, Notes, Glossary, Shell (header, footer, notes box)
scripts/            balance checks for the lessons
```

### Adding a lesson

Add an entry to `SCENARIOS` in `src/content/scenarios.ts`: the broken starting setup
(`base`), timed incidents (`script`), goals, the parts the player gets (`task.tools`) and
the `solution.fix`. Run `npm run verify` to confirm the broken setup fails and the
solution passes.
