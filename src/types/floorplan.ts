export type Tool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'draw'
  | 'ap'
  | 'room'
  | 'eraser';

export type WallMaterial = 'concrete' | 'brick' | 'drywall' | 'glass';

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  material: WallMaterial;
}

export interface Opening {
  id: string;
  wallId: string;
  /** 0~1 along wall from a → b */
  t: number;
  width: number;
  kind: 'door' | 'window';
}

export interface AccessPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  /** dBm transmit power approximation */
  power: number;
  band: '2.4' | '5' | '6';
}

export interface RoomLabel {
  id: string;
  x: number;
  y: number;
  name: string;
}

export interface Stroke {
  id: string;
  points: number[];
  color: string;
}

export interface FloorPlan {
  walls: Wall[];
  openings: Opening[];
  aps: AccessPoint[];
  rooms: RoomLabel[];
  strokes: Stroke[];
  /** pixels per meter */
  pixelsPerMeter: number;
}

export type SignalLevel = 'excellent' | 'good' | 'weak' | 'poor';

/** One radio of the router, as reported by OpenWrt (iwinfo / network.wireless) */
export interface RouterRadio {
  band: '2.4' | '5' | '6';
  ssid?: string;
  channel?: number;
  /** transmit power in dBm */
  txpower?: number;
  htmode?: string;
  /** associated client count on this radio */
  clients?: number;
}

/** Router information, sourced from an OpenWrt system (ubus) or a demo fallback */
export interface RouterInfo {
  model: string;
  boardName?: string;
  firmware?: string;
  radios: RouterRadio[];
  /** total associated clients across radios */
  clients: number;
  /** seconds since boot */
  uptime?: number;
  /** where the data came from */
  source: 'openwrt' | 'demo';
}

/** Per-room signal estimate derived from the heatmap simulation */
export interface RoomSignal {
  roomId: string;
  name: string;
  /** best RSSI at the room label position, dBm */
  rssi: number;
  level: SignalLevel;
}

export interface AiFloorPlanPayload {
  units: 'm';
  scale?: { pixelsPerMeter: number };
  walls: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    material?: WallMaterial;
  }>;
  doors?: Array<{ wallIndex: number; t: number; width: number }>;
  windows?: Array<{ wallIndex: number; t: number; width: number }>;
  rooms?: Array<{ name: string; x: number; y: number }>;
}

export const MATERIAL_LOSS_DB: Record<WallMaterial, number> = {
  concrete: 15,
  brick: 10,
  drywall: 4,
  glass: 2,
};

export const OPENING_LOSS_DB = {
  door: 3,
  window: 2,
} as const;

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
