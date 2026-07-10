import {
  MATERIAL_LOSS_DB,
  OPENING_LOSS_DB,
  type AccessPoint,
  type FloorPlan,
  type Opening,
  type Point,
  type RoomSignal,
  type SignalLevel,
  type Wall,
} from '../types/floorplan';
import { dist, pointOnWall, segmentHitsWall, wallLength } from './geometry';

export interface HeatmapResult {
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  /** dBm values, row-major */
  values: Float32Array;
  min: number;
  max: number;
}

function openingCoversHit(wall: Wall, openings: Opening[], sample: Point, ap: Point): boolean {
  if (!segmentHitsWall(ap, sample, wall)) return false;
  const related = openings.filter((o) => o.wallId === wall.id);
  if (!related.length) return false;

  // Approximate hit position on wall by projecting midpoint of AP-sample onto wall? Use closest point on wall to line.
  // Simpler: project sample→ap intersection approx as projection of midpoint.
  const mid = { x: (ap.x + sample.x) / 2, y: (ap.y + sample.y) / 2 };
  const len = wallLength(wall) || 1;
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const t = Math.max(0, Math.min(1, ((mid.x - wall.a.x) * dx + (mid.y - wall.a.y) * dy) / (len * len)));

  return related.some((o) => {
    const half = o.width / (2 * len);
    return Math.abs(t - o.t) <= half;
  });
}

function pathLossDb(meters: number, band: AccessPoint['band']): number {
  const f = band === '2.4' ? 2.4e9 : band === '5' ? 5.2e9 : 6.2e9;
  // Free-space path loss
  const fspl = 20 * Math.log10(Math.max(meters, 0.3)) + 20 * Math.log10(f) - 147.55;
  return fspl;
}

function rssiAt(
  sample: Point,
  ap: AccessPoint,
  walls: Wall[],
  openings: Opening[],
  ppm: number,
): number {
  const meters = dist(sample, ap) / ppm;
  let loss = pathLossDb(meters, ap.band);

  for (const wall of walls) {
    if (!segmentHitsWall(ap, sample, wall)) continue;
    if (openingCoversHit(wall, openings, sample, ap)) {
      const kind = openings.find((o) => o.wallId === wall.id)?.kind ?? 'door';
      loss += OPENING_LOSS_DB[kind];
    } else {
      loss += MATERIAL_LOSS_DB[wall.material];
    }
  }

  return ap.power - loss;
}

export function computeHeatmap(
  plan: FloorPlan,
  canvasWidth: number,
  canvasHeight: number,
  cellSize = 16,
): HeatmapResult | null {
  if (!plan.aps.length) return null;

  const cols = Math.ceil(canvasWidth / cellSize);
  const rows = Math.ceil(canvasHeight / cellSize);
  const values = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sample = {
        x: col * cellSize + cellSize / 2,
        y: row * cellSize + cellSize / 2,
      };
      let best = -120;
      for (const ap of plan.aps) {
        const rssi = rssiAt(sample, ap, plan.walls, plan.openings, plan.pixelsPerMeter);
        if (rssi > best) best = rssi;
      }
      values[row * cols + col] = best;
      if (best < min) min = best;
      if (best > max) max = best;
    }
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    cellSize,
    originX: 0,
    originY: 0,
    cols,
    rows,
    values,
    min: Number.isFinite(min) ? min : -90,
    max: Number.isFinite(max) ? max : -40,
  };
}

export function rssiToRgba(rssi: number, min: number, max: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (rssi - min) / Math.max(max - min, 1e-3)));
  // blue → cyan → green → yellow → red
  const stops: Array<[number, number, number]> = [
    [30, 64, 175],
    [8, 145, 178],
    [22, 163, 74],
    [234, 179, 8],
    [220, 38, 38],
  ];
  const scaled = t * (stops.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = stops[Math.min(i, stops.length - 1)];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    Math.round(55 + t * 140),
  ];
}

export function heatmapToImageData(result: HeatmapResult): ImageData {
  const { cols, rows, cellSize, values, min, max } = result;
  const w = cols * cellSize;
  const h = rows * cellSize;
  const data = new Uint8ClampedArray(w * h * 4);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rssi = values[row * cols + col];
      const [r, g, b, a] = rssiToRgba(rssi, min, max);
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          const px = (row * cellSize + y) * w + (col * cellSize + x);
          const i = px * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
    }
  }

  return new ImageData(data, w, h);
}

export function summarizeCoverage(result: HeatmapResult): {
  excellent: number;
  good: number;
  weak: number;
  poor: number;
} {
  let excellent = 0;
  let good = 0;
  let weak = 0;
  let poor = 0;
  for (const v of result.values) {
    if (v >= -55) excellent++;
    else if (v >= -67) good++;
    else if (v >= -75) weak++;
    else poor++;
  }
  const total = result.values.length || 1;
  return {
    excellent: excellent / total,
    good: good / total,
    weak: weak / total,
    poor: poor / total,
  };
}

export function openingCenter(wall: Wall, opening: Opening): Point {
  return pointOnWall(wall, opening.t);
}

export function signalLevel(rssi: number): SignalLevel {
  if (rssi >= -55) return 'excellent';
  if (rssi >= -67) return 'good';
  if (rssi >= -75) return 'weak';
  return 'poor';
}

/** Best RSSI (across all APs) at an arbitrary point on the plan. */
export function bestRssiAt(plan: FloorPlan, point: Point): number {
  let best = -120;
  for (const ap of plan.aps) {
    const rssi = rssiAt(point, ap, plan.walls, plan.openings, plan.pixelsPerMeter);
    if (rssi > best) best = rssi;
  }
  return best;
}

/** Estimate the signal at each labelled room (using the room label position). */
export function roomSignals(plan: FloorPlan): RoomSignal[] {
  if (!plan.aps.length) return [];
  return plan.rooms.map((room) => {
    const rssi = bestRssiAt(plan, { x: room.x, y: room.y });
    return { roomId: room.id, name: room.name, rssi, level: signalLevel(rssi) };
  });
}
