import {
  BaseEdge,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getStraightPath,
  useReactFlow,
  useStoreApi,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GripVertical, LayoutGrid, Minus, MousePointerClick, Plus, X } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Sim } from '../sim/engine';
import type { PacketKind, SimConfig } from '../sim/types';
import { CONTROL_MAP } from '../content/controls';
import { nodeState, visibleNodes, wires, type Wire } from './graph';
import { NODE_COLOR, NODE_MAP } from './layout';
import { ControlList } from './Panels';
import { PIECES, PIECE_MAP, SAGA_STEPS, STEPPERS, type PieceDef } from './pieces';

// ───────── shared state for nodes and wires

type Selection = { piece: string; target: string } | { node: string } | null;
interface Ctx {
  sim: Sim;
  cfg: SimConfig;
  editable: boolean;
  shows: (pieceId: string) => boolean;
  pending: string | null;
  selected: Selection;
  place: (pieceId: string, target: string) => void;
  select: (s: Selection) => void;
  setCfg: (c: SimConfig) => void;
  steppersFor: (node: string) => (typeof STEPPERS)[string];
}
const C = createContext<Ctx | null>(null);
const useCtx = () => useContext(C)!;

export const PACKET_COLORS: Record<PacketKind, string> = {
  browse: '#3b5bdb',
  checkout: '#7c3aed',
  call: '#d97706',
  retry: '#ea580c',
  event: '#0ea5b7',
  fail: '#dc2626',
  bot: '#9ca3af',
  reject: '#dc2626',
  cache: '#16a34a',
  db: '#16a34a',
};
export const PACKET_LEGEND: [PacketKind, string][] = [
  ['browse', 'page view'],
  ['checkout', 'checkout'],
  ['call', 'call'],
  ['retry', 'retry'],
  ['event', 'event'],
  ['fail', 'failure'],
  ['bot', 'bot'],
];

function stickersOn(kind: PieceDef['kind'], target: string, cfg: SimConfig, shows: (id: string) => boolean) {
  return PIECES.filter((p) => p.kind === kind && p.targets.includes(target) && p.label && p.isOn(cfg, target) && (shows(p.id) || p.bad));
}

// ───────── a station on the map

function Sticker({ p, target }: { p: PieceDef; target: string }) {
  const { cfg, selected, select } = useCtx();
  const Icon = p.icon;
  const on = selected && 'piece' in selected && selected.piece === p.id && selected.target === target;
  return (
    <button
      className={`sticker nodrag${on ? ' on' : ''}${p.bad ? ' bad' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        select({ piece: p.id, target });
      }}
      title={p.name}
    >
      <Icon size={12} strokeWidth={2.4} />
      <span>{p.name}</span>
      {!p.name.toLowerCase().includes(p.label!(cfg, target).toLowerCase()) && <span className="sticker-val">{p.label!(cfg, target)}</span>}
    </button>
  );
}

function StationNode({ id }: NodeProps) {
  const { sim, cfg, shows, pending, place, select, selected, editable, setCfg, steppersFor } = useCtx();
  const def = NODE_MAP[id];
  const st = nodeState(id, sim);
  const Icon = def.icon;
  const pend = pending ? PIECE_MAP[pending] : null;
  const valid = !!pend && pend.kind === 'node' && pend.targets.includes(id);
  const stickers = stickersOn('node', id, cfg, shows);
  const steppers = steppersFor(id);
  const isSel = selected && 'node' in selected && selected.node === id;
  return (
    <div
      className={`station tone-${st.tone} kind-${def.kind}${valid ? ' drop-ok' : ''}${isSel ? ' sel' : ''}`}
      style={{ ['--k' as string]: `var(--t-${NODE_COLOR[id] ?? 'purple'})` }}
      role="button"
      tabIndex={0}
      aria-label={`${def.label}: ${st.line}`}
      onClick={() => (valid ? place(pend!.id, id) : select({ node: id }))}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (valid) place(pend!.id, id);
          else select({ node: id });
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="hub" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="hub" isConnectable={false} />
      <div className="station-head">
        <span className="station-icon">
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span className="station-name">{def.label}</span>
        <span className="station-lamp" />
      </div>
      <div className="station-line">{st.line}</div>
      {st.bar !== undefined && (
        <div className="station-bar">
          <i style={{ width: `${Math.max(0, Math.min(1, st.bar)) * 100}%` }} />
        </div>
      )}
      {st.badge && <div className={`station-badge tone-${st.badge.tone}`}>{st.badge.text}</div>}
      {(stickers.length > 0 || steppers.length > 0) && (
        <div className="station-parts">
          {stickers.map((p) => (
            <Sticker key={p.id} p={p} target={id} />
          ))}
          {steppers.map((s) => {
            const v = Number(cfg[s.path]);
            const set = (n: number) => setCfg({ ...cfg, [s.path]: Math.max(s.min, Math.min(s.max, n)) });
            return (
              <span className="stepper nodrag" key={s.path} onClick={(e) => e.stopPropagation()}>
                <button disabled={!editable || v <= s.min} onClick={() => set(v - s.step)} aria-label={`Fewer ${s.label}`}>
                  <Minus size={11} />
                </button>
                <b>{v}</b> {s.label}
                <button disabled={!editable || v >= s.max} onClick={() => set(v + s.step)} aria-label={`More ${s.label}`}>
                  <Plus size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {valid && <div className="drop-hint">Drop {pend!.name} here</div>}
    </div>
  );
}

// ───────── a wire between stations

function WireEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<{ route: Wire['route'] }>>) {
  const { cfg, shows, pending, place } = useCtx();
  const [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const stickers = stickersOn('wire', id, cfg, shows);
  const pend = pending ? PIECE_MAP[pending] : null;
  const valid = !!pend && pend.kind === 'wire' && pend.targets.includes(id);
  return (
    <>
      <BaseEdge id={id} path={path} className={`wire route-${data?.route ?? 'call'}${valid ? ' drop-ok' : ''}`} interactionWidth={24} />
      {(stickers.length > 0 || valid) && (
        <EdgeLabelRenderer>
          <div className="wire-parts nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {stickers.map((p) => (
              <Sticker key={p.id} p={p} target={id} />
            ))}
            {valid && (
              <button className="sticker drop" onClick={() => place(pend!.id, id)}>
                <Plus size={12} /> {pend!.name}
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { station: StationNode };
const edgeTypes = { wire: WireEdge };

// ───────── moving traffic, drawn over the map

function PacketLayer({ sim, vis }: { sim: Sim; vis: Set<string> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi();
  const rf = useReactFlow();
  const simRef = useRef(sim);
  simRef.current = sim;
  const visRef = useRef(vis);
  visRef.current = vis;
  useEffect(() => {
    let raf = 0;
    const centers = new Map<string, { x: number; y: number }>();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv?.parentElement) return;
      const w = cv.parentElement.clientWidth;
      const h = cv.parentElement.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
      }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const [tx, ty, zoom] = store.getState().transform;
      centers.clear();
      const center = (id: string) => {
        let c = centers.get(id);
        if (c) return c;
        const n = rf.getInternalNode(id);
        if (!n) return undefined;
        const p = n.internals.positionAbsolute;
        c = { x: p.x + (n.measured.width ?? 180) / 2, y: p.y + (n.measured.height ?? 70) / 2 };
        centers.set(id, c);
        return c;
      };
      const s = simRef.current;
      const now = s.now;
      for (const p of s.packets) {
        if (p.t1 < now || p.t0 > now || !visRef.current.has(p.from) || !visRef.current.has(p.to)) continue;
        const a = center(p.from);
        const b = center(p.to);
        if (!a || !b) continue;
        const k = (now - p.t0) / (p.t1 - p.t0);
        if (k < 0.12 || k > 0.88) continue; // stay off the station cards
        const x = (a.x + (b.x - a.x) * k) * zoom + tx;
        const y = (a.y + (b.y - a.y) * k) * zoom + ty;
        const r = (p.kind === 'fail' || p.kind === 'reject' ? 5 : 4) * Math.max(0.6, zoom);
        ctx.beginPath();
        ctx.fillStyle = PACKET_COLORS[p.kind];
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [rf, store]);
  return <canvas ref={ref} className="packet-layer" />;
}

// ───────── the canvas

export interface CanvasProps {
  sim: Sim;
  cfg: SimConfig;
  baseNodes: string[];
  tools: string[] | 'all';
  editable: boolean;
  onChange: (c: SimConfig) => void;
  tick: number;
  saga?: boolean;
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ sim, cfg, baseNodes, tools, editable, onChange, tick, saga }: CanvasProps) {
  const rf = useReactFlow();
  const vis = visibleNodes(baseNodes, cfg);
  const visKey = [...vis].sort().join(',');
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [toast, setToast] = useState<string | null>(null);
  const positions = useRef<Record<string, { x: number; y: number }>>({});
  const toastTimer = useRef(0);

  const shows = (pieceId: string) => (tools === 'all' ? !['planB', 'split'].includes(pieceId) : tools.includes(pieceId));
  const stepperKeys = tools === 'all' ? Object.keys(STEPPERS) : tools.filter((t) => t in STEPPERS);
  const steppersFor = (node: string) => stepperKeys.flatMap((k) => STEPPERS[k]).filter((s) => s.node === node);
  const bin = PIECES.filter((p) => p.inBin !== false && shows(p.id));
  const compact = bin.length > 6;
  const [binOpen, setBinOpen] = useState(!compact);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const initialNodes = (): Node[] => [...vis].map((id) => ({ id, type: 'station', position: positions.current[id] ?? { x: NODE_MAP[id].x, y: NODE_MAP[id].y }, data: {} }));
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  useEffect(() => {
    setNodes((prev) => {
      const keep = new Map(prev.map((n) => [n.id, n]));
      return [...vis].map((id) => keep.get(id) ?? { id, type: 'station', position: positions.current[id] ?? { x: NODE_MAP[id].x, y: NODE_MAP[id].y }, data: {} });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visKey]);
  const onNodesChange = (ch: NodeChange[]) => setNodes((ns) => applyNodeChanges(ch, ns));

  const ws = wires(vis, cfg);
  const edges: Edge[] = ws.map((w) => ({ id: w.id, source: w.source, target: w.target, type: 'wire', data: { route: w.route } }));

  const where = (target: string) => {
    if (target === 'saga') return 'the saga';
    if (NODE_MAP[target]) return NODE_MAP[target].label;
    const [a, b] = target.split('-');
    return `${NODE_MAP[a]?.label ?? a} → ${NODE_MAP[b]?.label ?? b}`;
  };

  const place = (pieceId: string, target: string) => {
    const p = PIECE_MAP[pieceId];
    if (!editable) return;
    setPending(null);
    if (p.isOn(cfg, target) && pieceId !== 'workers') {
      flash(`${p.name} is already on ${where(target)}.`);
      setSelected(p.kind === 'station' ? { node: target } : { piece: pieceId, target });
      return;
    }
    onChange(p.add(cfg, target));
    flash(`${p.name} added to ${where(target)}.`);
    if (p.kind === 'station') setSelected({ node: target });
    else if (p.label) setSelected({ piece: pieceId, target });
  };

  const centerOf = (id: string) => {
    const n = rf.getInternalNode(id);
    if (!n) return null;
    const p = n.internals.positionAbsolute;
    const w = n.measured.width ?? 180;
    const h = n.measured.height ?? 70;
    return { x: p.x + w / 2, y: p.y + h / 2, w, h, left: p.x, top: p.y };
  };

  const dropAt = (pieceId: string, pt: { x: number; y: number }) => {
    const p = PIECE_MAP[pieceId];
    if (!p) return;
    if (p.kind === 'station') {
      const station = p.targets[0];
      if (!p.isOn(cfg, station)) {
        positions.current[station] = { x: pt.x - 90, y: pt.y - 30 };
        setNodes((ns) => ns.filter((n) => n.id !== station));
      }
      return place(pieceId, station);
    }
    if (p.kind === 'saga') return saga ? place(pieceId, 'saga') : flash('There is no saga in this scenario.');
    if (p.kind === 'node') {
      const cands = p.targets.filter((t) => vis.has(t));
      let best: string | null = null;
      let bestD = 170;
      for (const t of cands) {
        const c = centerOf(t);
        if (!c) continue;
        if (pt.x >= c.left && pt.x <= c.left + c.w && pt.y >= c.top && pt.y <= c.top + c.h) {
          best = t;
          break;
        }
        const d = Math.hypot(pt.x - c.x, pt.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) return place(pieceId, best);
      return flash(cands.length ? `${p.name} goes on ${cands.map(where).join(' or ')}.` : `Nowhere to put ${p.name} on this map yet.`);
    }
    // wire: nearest segment
    let best: string | null = null;
    let bestD = 90;
    for (const w of ws) {
      if (!p.targets.includes(w.id)) continue;
      const a = centerOf(w.source);
      const b = centerOf(w.target);
      if (!a || !b) continue;
      const d = segDist(pt, a, b);
      if (d < bestD) {
        bestD = d;
        best = w.id;
      }
    }
    if (best) return place(pieceId, best);
    const cands = ws.filter((w) => p.targets.includes(w.id));
    flash(cands.length ? `${p.name} goes on a wire: ${cands.map((w) => where(w.id)).join(', ')}.` : `Nowhere to put ${p.name} on this map yet.`);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('application/x-piece');
    if (!id || !editable) return;
    dropAt(id, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const pickFromBin = (p: PieceDef) => {
    if (!editable) return;
    if (p.kind === 'station') return place(p.id, p.targets[0]);
    if (p.kind === 'saga') return saga ? place(p.id, 'saga') : flash('There is no saga in this scenario.');
    if (p.id === 'workers') return place(p.id, 'invWorkers');
    setPending((cur) => (cur === p.id ? null : p.id));
  };

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPending(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const ctx: Ctx = useMemo(
    () => ({ sim, cfg, editable, shows, pending, selected, place, select: setSelected, setCfg: onChange, steppersFor }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim, cfg, editable, pending, selected, tick, tools],
  );

  return (
    <C.Provider value={ctx}>
      <div className="canvas-wrap">
      <div className={`canvas${pending ? ' placing' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgeClick={(_, e) => pending && PIECE_MAP[pending].targets.includes(e.id) && place(pending, e.id)}
          onPaneClick={() => {
            setPending(null);
            setSelected(null);
          }}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          zoomOnPinch
          panOnScroll={false}
          minZoom={0.3}
          maxZoom={1.6}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--dots)" />
          <Controls showInteractive={false} position="top-left">
            <ControlButton
              title="Tidy up the map"
              aria-label="Tidy up the map"
              onClick={() => {
                positions.current = {};
                setNodes(initialNodes().map((n) => ({ ...n, position: { x: NODE_MAP[n.id].x, y: NODE_MAP[n.id].y } })));
                window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 300 }), 30);
              }}
            >
              <LayoutGrid size={13} />
            </ControlButton>
          </Controls>
          <PacketLayer sim={sim} vis={vis} />
          {saga && <SagaStrip />}
          {toast && (
            <Panel position="top-center">
              <div className="toast">{toast}</div>
            </Panel>
          )}
          {selected && <Inspector selected={selected} onClose={() => setSelected(null)} where={where} />}
        </ReactFlow>
      </div>
          {editable && bin.length > 0 && (
              <div className={`bin${compact ? ' compact' : ''}`}>
                <div className="bin-head">
                  {compact ? (
                    <button className="bin-toggle" onClick={() => setBinOpen((o) => !o)} aria-expanded={binOpen}>
                      <b>Parts bin</b> <span className="mono">{bin.length}</span> {binOpen ? '▾' : '▸'}
                    </button>
                  ) : (
                    <b>Parts bin</b>
                  )}
                  <span>{pending ? `Click a highlighted spot to place ${PIECE_MAP[pending].name}. Esc cancels.` : 'Drag a part onto the map, or click it and then a highlighted spot.'}</span>
                </div>
                {binOpen && (
                  <div className="bin-parts">
                  {bin.map((p) => {
                    const Icon = p.icon;
                    const placed = p.kind === 'station' && p.isOn(cfg, p.targets[0]);
                    return (
                      <button
                        key={p.id}
                        className={`part-tile${pending === p.id ? ' pending' : ''}${placed ? ' placed' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-piece', p.id);
                          e.dataTransfer.effectAllowed = 'copy';
                          setPending(p.id);
                        }}
                        onDragEnd={() => setPending(null)}
                        onClick={() => pickFromBin(p)}
                        title={p.blurb}
                      >
                        <GripVertical size={12} className="grip" />
                        <Icon size={18} strokeWidth={2.2} />
                        <span>
                          <b>{p.name}</b>
                          <small>{placed ? 'on the map' : p.blurb}</small>
                        </span>
                      </button>
                    );
                  })}
                  </div>
                )}
              </div>
          )}
          {editable && bin.length === 0 && (
              <div className="bin-head solo">
                <MousePointerClick size={14} /> Drag stations to rearrange the map.
              </div>
          )}
      </div>
    </C.Provider>
  );
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ───────── inspector for a selected part or station

function Inspector({ selected, onClose, where }: { selected: NonNullable<Selection>; onClose: () => void; where: (t: string) => string }) {
  const { cfg, editable, setCfg, sim, shows, steppersFor } = useCtx();
  if ('piece' in selected) {
    const p = PIECE_MAP[selected.piece];
    const Icon = p.icon;
    const dials = p.dials?.(selected.target).filter((k) => CONTROL_MAP[k]) ?? [];
    return (
      <Panel position="bottom-right">
        <div className="inspector">
          <div className="insp-head">
            <Icon size={16} />
            <div>
              <b>{p.name}</b>
              <small>on {where(selected.target)}</small>
            </div>
            <button className="x" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <p className="insp-blurb">{p.blurb}.</p>
          {dials.length > 0 && <ControlList keys={dials} cfg={cfg} onChange={setCfg} locked={!editable} />}
          {editable && p.remove && shows(p.id) && (
            <button
              className="btn sm danger-outline"
              onClick={() => {
                setCfg(p.remove!(cfg, selected.target));
                onClose();
              }}
            >
              Remove {p.name.toLowerCase()}
            </button>
          )}
        </div>
      </Panel>
    );
  }
  const id = selected.node;
  const def = NODE_MAP[id];
  const st = nodeState(id, sim);
  const station = PIECES.find((p) => p.kind === 'station' && p.targets[0] === id);
  const dials = station?.dials?.(id) ?? (id === 'relay' ? ['relayMode'] : []);
  const Icon = def.icon;
  return (
    <Panel position="bottom-right">
      <div className="inspector">
        <div className="insp-head">
          <Icon size={16} />
          <div>
            <b>{def.label}</b>
            <small>{st.line}</small>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <p className="insp-blurb">{STATION_BLURB[id] ?? ''}</p>
        {steppersFor(id).length > 0 && <p className="insp-blurb muted">Use − and + on the station to scale it.</p>}
        {dials.length > 0 && <ControlList keys={dials} cfg={cfg} onChange={setCfg} locked={!editable || !(station ? shows(station.id) : shows('outbox'))} />}
        {editable && station?.remove && shows(station.id) && station.isOn(cfg, id) && (
          <button
            className="btn sm danger-outline"
            onClick={() => {
              setCfg(station.remove!(cfg, id));
              onClose();
            }}
          >
            Remove {def.label.toLowerCase()}
          </button>
        )}
      </div>
    </Panel>
  );
}

const STATION_BLURB: Record<string, string> = {
  admin: 'Staff change prices here. It writes straight to the product database.',
  web: 'Customers browsing on a computer.',
  mobile: 'Customers on phones, sometimes on weak signals.',
  bot: 'A script copying the catalog.',
  gateway: 'One front door. Routes each request and runs shared checks like rate limits.',
  monolith: 'The whole shop as one program. Every copy carries every module.',
  product: 'Serves product pages.',
  order: 'Takes orders. Holds a thread for each request until it answers.',
  orderDb: 'Where orders are saved.',
  outbox: 'Events saved in the same transaction as the order.',
  relay: 'Reads the outbox and publishes each row to the broker.',
  cache: 'Fast copies of product pages.',
  productDb: 'The source of truth for products and prices. 10 connections.',
  payment: 'Our payment service. Calls the card company.',
  payco: 'The card company. Outside our control.',
  inventory: 'Checks and reserves stock.',
  shipping: 'Books deliveries and tracks parcels.',
  recs: '“Customers also bought” suggestions. Nice to have.',
  readModel: 'A copy shaped for the “My orders” page, kept current by events.',
  broker: 'Holds events until subscribers pick them up.',
  invWorkers: 'Consumers reserving stock from the queue. More than 12 overload the database.',
  dlq: 'Messages that failed too often, waiting for a person to fix and replay.',
  notifWorkers: 'Consumers sending confirmation emails.',
  email: 'The email company. Outside our control.',
};

// ───────── saga strip: drag steps into order

function SagaStrip() {
  const { cfg, setCfg, editable, shows, pending, place, sim } = useCtx();
  const steps = cfg.sagaOrder.split('>');
  const canSort = editable && shows('sagaOrder');
  const [drag, setDrag] = useState<number | null>(null);
  const pend = pending ? PIECE_MAP[pending] : null;
  const valid = !!pend && pend.kind === 'saga';
  const move = (from: number, to: number) => {
    const s = [...steps];
    const [x] = s.splice(from, 1);
    s.splice(to, 0, x);
    setCfg({ ...cfg, sagaOrder: s.join('>') });
  };
  const sagaStickers = PIECES.filter((p) => p.kind === 'saga' && (shows(p.id) || p.isOn(cfg, 'saga')));
  return (
    <Panel position="top-right" className="saga-panel">
      <div
        className={`saga${valid ? ' drop-ok' : ''}`}
        role={valid ? 'button' : undefined}
        tabIndex={valid ? 0 : undefined}
        aria-label={valid ? `Place ${pend!.name} on the saga` : undefined}
        onClick={() => valid && place(pend!.id, 'saga')}
        onKeyDown={(e) => valid && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && place(pend!.id, 'saga')}
      >
        <div className="saga-head">
          <b>Order saga</b>
          <span>{sim.sagasRunning} running</span>
        </div>
        <ol className="saga-steps">
          <li className="saga-step fixed">Save order</li>
          {steps.map((s, i) => (
            <li
              key={s}
              className={`saga-step${canSort ? ' sortable' : ''}${drag === i ? ' dragging' : ''}${s === 'capture' ? ' money' : ''}`}
              draggable={canSort}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData('text/plain', s);
                setDrag(i);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (drag !== null && drag !== i) move(drag, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              {canSort && <GripVertical size={12} />}
              {SAGA_STEPS[s]}
            </li>
          ))}
        </ol>
        <div className="saga-parts">
          {sagaStickers.map((p) => {
            const on = p.isOn(cfg, 'saga');
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                className={`sticker${on ? '' : ' off'}`}
                disabled={!editable || !shows(p.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  setCfg(on ? p.remove!(cfg, 'saga') : p.add(cfg, 'saga'));
                }}
              >
                <Icon size={12} /> {p.label!(cfg, 'saga')}: {on ? 'on' : 'off'}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
