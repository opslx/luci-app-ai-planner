import {
  MATERIAL_LOSS_DB,
  OPENING_LOSS_DB,
} from '../types/floorplan';
import type {
  AccessPoint,
  ClientConfidence,
  FloorPlan,
  Opening,
  Point,
  RoomCalibration,
  RoomSignal,
  SignalLevel,
  Wall,
  WalkSurveyPoint,
  WifiClient,
} from '../types/floorplan';
import { dist, pointOnWall, segmentWallIntersection, wallLength } from './geometry';

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

function pathLossDb(meters: number, band: AccessPoint['band']): number {
  const oneMeterLoss = band === '2.4' ? 40.1 : band === '5' ? 46.7 : 48.3;
  const pathLossExponent = band === '2.4' ? 2.3 : band === '5' ? 2.6 : 2.8;
  return oneMeterLoss + 10 * pathLossExponent * Math.log10(Math.max(meters, 0.8));
}

export function distanceFromRssi(
  rssi: number,
  txPower: number,
  band: AccessPoint['band'],
): number {
  const oneMeterLoss = band === '2.4' ? 40.1 : band === '5' ? 46.7 : 48.3;
  const pathLossExponent = band === '2.4' ? 2.3 : band === '5' ? 2.6 : 2.8;
  const loss = txPower - rssi;
  const meters = 10 ** ((loss - oneMeterLoss) / (10 * pathLossExponent));
  return Math.max(0.3, Math.min(meters, 80));
}

export function rssiAtPoint(
  plan: FloorPlan,
  point: Point,
  ap: AccessPoint,
): number {
  return rssiAt(point, ap, plan.walls, plan.openings, plan.pixelsPerMeter);
}

/** Room signals with optional measured RSSI from walk survey calibration. */
export function roomSignalsWithCalibration(
  plan: FloorPlan,
  calibrations: RoomCalibration[] = [],
): Array<RoomSignal & { measuredRssi?: number; offsetDb?: number }> {
  const calMap = new Map(calibrations.map((c) => [c.roomId, c]));
  return roomSignals(plan).map((r) => {
    const cal = calMap.get(r.roomId);
    return cal
      ? {
          ...r,
          calibratedRssi: r.rssi + cal.offsetDb,
          level: signalLevel(r.rssi + cal.offsetDb),
          measuredRssi: cal.measuredRssi,
          offsetDb: cal.offsetDb,
        }
      : r;
  });
}

function confidenceFromScore(score: number): ClientConfidence {
  if (score < 5) return 'high';
  if (score < 12) return 'medium';
  return 'low';
}

/** Match measured client RSSI to the most likely labelled room (single-AP coarse estimate). */
export function estimateClientLocations(
  plan: FloorPlan,
  clients: WifiClient[],
  calibrations: RoomCalibration[] = [],
): WifiClient[] {
  const offsetByRoom = new Map(calibrations.map((c) => [c.roomId, c.offsetDb]));

  if (!plan.aps.length) {
    return clients.map((c) => ({
      ...c,
      estimatedDistanceM: distanceFromRssi(c.signal, 20, c.band),
    }));
  }

  return clients.map((client) => {
    const bandAps = plan.aps.filter((ap) => ap.band === client.band);
    const apsToUse = bandAps.length ? bandAps : plan.aps;
    const primaryAp = apsToUse[0];
    const estimatedDistanceM = distanceFromRssi(client.signal, primaryAp.power, client.band);

    if (!plan.rooms.length) {
      return { ...client, estimatedDistanceM };
    }

    let bestRoom = plan.rooms[0];
    let bestScore = Infinity;

    for (const room of plan.rooms) {
      const offset = offsetByRoom.get(room.id) ?? 0;
      let score = 0;
      for (const ap of apsToUse) {
        const simRssi = rssiAtPoint(plan, { x: room.x, y: room.y }, ap);
        score += Math.abs(simRssi + offset - client.signal);
      }
      if (score < bestScore) {
        bestScore = score;
        bestRoom = room;
      }
    }

    return {
      ...client,
      estimatedDistanceM,
      suspectedRoomId: bestRoom.id,
      suspectedRoomName: bestRoom.name,
      confidence: confidenceFromScore(bestScore / apsToUse.length),
      observations: apsToUse.map((ap) => ({
        apId: ap.id,
        signal: client.signal,
      })),
    };
  });
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
    const hit = segmentWallIntersection(ap, sample, wall);
    if (!hit) continue;
    const opening = openings.find((o) => {
      if (o.wallId !== wall.id) return false;
      const half = o.width / (2 * (wallLength(wall) || 1));
      return Math.abs(hit.wallT - o.t) <= half;
    });
    if (opening) {
      const kind = opening.kind;
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

export function rssiToRgba(rssi: number, _min: number, _max: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (rssi + 85) / 40));
  // ZTE-style: blue (weak) → cyan → yellow → red (strong)
  const stops: Array<[number, number, number]> = [
    [37, 99, 235],
    [14, 165, 233],
    [52, 211, 153],
    [251, 191, 36],
    [239, 68, 68],
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
    Math.round(38 + t * 115),
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

/** ZTE-style signal colors: red = strong, blue = weak */
export const SIGNAL_LEVEL_COLORS: Record<SignalLevel, string> = {
  excellent: '#ef4444',
  good: '#f97316',
  weak: '#38bdf8',
  poor: '#2563eb',
};

export const SIGNAL_LEVEL_LABELS: Record<SignalLevel, string> = {
  excellent: '优秀',
  good: '良好',
  weak: '偏弱',
  poor: '较差',
};

/** Best RSSI (across all APs) at an arbitrary point on the plan. */
export function bestRssiAt(plan: FloorPlan, point: Point): number {
  let best = -120;
  for (const ap of plan.aps) {
    const rssi = rssiAt(point, ap, plan.walls, plan.openings, plan.pixelsPerMeter);
    if (rssi > best) best = rssi;
  }
  return best;
}

function bestRssiAtForBand(plan: FloorPlan, point: Point, band: AccessPoint['band']): number {
  const aps = plan.aps.filter((ap) => ap.band === band);
  const apsToUse = aps.length ? aps : plan.aps;
  let best = -120;
  for (const ap of apsToUse) {
    const rssi = rssiAt(point, ap, plan.walls, plan.openings, plan.pixelsPerMeter);
    if (rssi > best) best = rssi;
  }
  return best;
}

function walkSurveyOffsetAt(plan: FloorPlan, point: Point, samples: WalkSurveyPoint[]): number {
  if (!samples.length) return 0;
  let weightedOffset = 0;
  let totalWeight = 0;

  for (const sample of samples) {
    const simulated = bestRssiAtForBand(plan, sample, sample.band);
    const offset = Math.max(-25, Math.min(25, sample.signal - simulated));
    const distanceM = dist(point, sample) / plan.pixelsPerMeter;
    const weight = 1 / Math.max(1, distanceM * distanceM);
    weightedOffset += offset * weight;
    totalWeight += weight;
  }
  return totalWeight ? weightedOffset / totalWeight : 0;
}

export function applyWalkSurveyToHeatmap(
  plan: FloorPlan,
  result: HeatmapResult,
  samples: WalkSurveyPoint[],
): HeatmapResult {
  if (!samples.length) return result;
  const values = new Float32Array(result.values.length);
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < result.rows; row++) {
    for (let col = 0; col < result.cols; col++) {
      const index = row * result.cols + col;
      const point = {
        x: result.originX + col * result.cellSize + result.cellSize / 2,
        y: result.originY + row * result.cellSize + result.cellSize / 2,
      };
      const rssi = result.values[index] + walkSurveyOffsetAt(plan, point, samples);
      values[index] = rssi;
      if (rssi < min) min = rssi;
      if (rssi > max) max = rssi;
    }
  }

  return { ...result, values, min, max };
}

/** Estimate the signal at each labelled room (using the room label position). */
export function roomSignals(plan: FloorPlan): RoomSignal[] {
  if (!plan.aps.length) return [];
  return plan.rooms.map((room) => {
    const rssi = bestRssiAt(plan, { x: room.x, y: room.y });
    return { roomId: room.id, name: room.name, rssi, level: signalLevel(rssi) };
  });
}
