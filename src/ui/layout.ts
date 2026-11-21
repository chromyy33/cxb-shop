import {
  Archive, Bot, BookOpen, Boxes, CreditCard, Database, DoorOpen, Inbox, Landmark, Mail, Monitor, Package,
  Radio, Send, ShoppingCart, Smartphone, Sparkles, Tag, Truck, Users, Wrench, Zap, Repeat, type LucideIcon,
} from 'lucide-react';

export type Kind = 'client' | 'edge' | 'service' | 'data' | 'external' | 'messaging';
export interface NodeDef {
  id: string;
  label: string;
  x: number; // default top-left position on the canvas
  y: number;
  icon: LucideIcon;
  kind: Kind;
}

export const NODES: NodeDef[] = [
  { id: 'admin', label: 'Admin tool', x: 0, y: 0, icon: Wrench, kind: 'client' },
  { id: 'web', label: 'Web app', x: 0, y: 170, icon: Monitor, kind: 'client' },
  { id: 'mobile', label: 'Mobile app', x: 0, y: 330, icon: Smartphone, kind: 'client' },
  { id: 'bot', label: 'Scraper bot', x: 0, y: 490, icon: Bot, kind: 'client' },
  { id: 'gateway', label: 'API gateway', x: 250, y: 330, icon: DoorOpen, kind: 'edge' },
  { id: 'product', label: 'Product service', x: 500, y: 90, icon: Tag, kind: 'service' },
  { id: 'monolith', label: 'Monolith', x: 500, y: 330, icon: Boxes, kind: 'service' },
  { id: 'order', label: 'Order service', x: 500, y: 330, icon: ShoppingCart, kind: 'service' },
  { id: 'orderDb', label: 'Order DB', x: 500, y: 560, icon: Database, kind: 'data' },
  { id: 'outbox', label: 'Outbox table', x: 500, y: 700, icon: Inbox, kind: 'messaging' },
  { id: 'cache', label: 'Cache', x: 760, y: -20, icon: Zap, kind: 'data' },
  { id: 'productDb', label: 'Product DB', x: 1020, y: 80, icon: Database, kind: 'data' },
  { id: 'payment', label: 'Payment', x: 760, y: 190, icon: CreditCard, kind: 'service' },
  { id: 'payco', label: 'PayCo (card co.)', x: 1020, y: 215, icon: Landmark, kind: 'external' },
  { id: 'inventory', label: 'Inventory', x: 760, y: 330, icon: Package, kind: 'service' },
  { id: 'shipping', label: 'Shipping', x: 1020, y: 345, icon: Truck, kind: 'service' },
  { id: 'recs', label: 'Recommendations', x: 760, y: 470, icon: Sparkles, kind: 'service' },
  { id: 'readModel', label: 'Read model', x: 1280, y: 330, icon: BookOpen, kind: 'data' },
  { id: 'broker', label: 'Message broker', x: 760, y: 640, icon: Radio, kind: 'messaging' },
  { id: 'relay', label: 'Relay', x: 760, y: 790, icon: Repeat, kind: 'messaging' },
  { id: 'invWorkers', label: 'Inventory workers', x: 1020, y: 560, icon: Users, kind: 'messaging' },
  { id: 'dlq', label: 'Dead letter queue', x: 1280, y: 560, icon: Archive, kind: 'messaging' },
  { id: 'notifWorkers', label: 'Email workers', x: 1020, y: 780, icon: Mail, kind: 'messaging' },
  { id: 'email', label: 'Email company', x: 1280, y: 780, icon: Send, kind: 'external' },
];

export const NODE_MAP = Object.fromEntries(NODES.map((n) => [n.id, n]));
export const ALL_NODE_IDS = NODES.map((n) => n.id).filter((id) => id !== 'monolith' && id !== 'admin');

/** Tile colour per station, like the service cards in the course. */
export const NODE_COLOR: Record<string, 'purple' | 'blue' | 'teal' | 'orange' | 'green' | 'pink' | 'grey'> = {
  admin: 'grey',
  web: 'blue',
  mobile: 'blue',
  bot: 'grey',
  gateway: 'purple',
  monolith: 'purple',
  order: 'purple',
  product: 'teal',
  payment: 'teal',
  payco: 'grey',
  inventory: 'blue',
  recs: 'pink',
  shipping: 'orange',
  orderDb: 'green',
  productDb: 'green',
  cache: 'orange',
  readModel: 'green',
  outbox: 'blue',
  relay: 'blue',
  broker: 'blue',
  invWorkers: 'blue',
  notifWorkers: 'blue',
  dlq: 'orange',
  email: 'grey',
};
