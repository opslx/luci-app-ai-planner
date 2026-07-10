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
  role?: 'main' | 'node';
  nodeId?: string;
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

export type ClientConfidence = 'high' | 'medium' | 'low';

/** Associated Wi-Fi client as reported by iwinfo (OpenWrt) or demo data */
export interface WifiClient {
  mac: string;
  hostname?: string;
  /** measured RSSI in dBm */
  signal: number;
  noise?: number;
  snr?: number;
  inactiveMs?: number;
  rxRateMbps?: number;
  txRateMbps?: number;
  band: '2.4' | '5' | '6';
  ifname: string;
  suspectedRoomId?: string;
  suspectedRoomName?: string;
  confidence?: ClientConfidence;
  /** free-space estimate from RSSI, meters */
  estimatedDistanceM?: number;
  /** per-AP RSSI when mesh has multiple nodes */
  observations?: Array<{ apId: string; signal: number }>;
}

/** Router information, sourced from an OpenWrt system (ubus) or a demo fallback */
export interface RouterInfo {
  model: string;
  boardName?: string;
  firmware?: string;
  radios: RouterRadio[];
  /** total associated clients across radios */
  clients: number;
  /** live associated clients (may be empty until polled) */
  clientList: WifiClient[];
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
  calibratedRssi?: number;
  level: SignalLevel;
}

/** One RSSI sample taken while standing in a labelled room */
export interface SurveySample {
  id: string;
  roomId: string;
  roomName: string;
  mac: string;
  signal: number;
  band: '2.4' | '5' | '6';
  ts: number;
}

export interface WalkSurveyPoint {
  id: string;
  x: number;
  y: number;
  mac: string;
  signal: number;
  band: '2.4' | '5' | '6';
  sampleCount: number;
  ts: number;
}

/** Calibrated offset between simulated and measured RSSI per room */
export interface RoomCalibration {
  roomId: string;
  roomName: string;
  measuredRssi: number;
  simulatedRssi: number;
  offsetDb: number;
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
