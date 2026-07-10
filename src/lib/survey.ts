import { rssiAtPoint } from './heatmap';
import type { FloorPlan, RoomCalibration, SurveySample, WalkSurveyPoint } from '../types/floorplan';

export function median(values: number[]): number {
  if (!values.length) return -75;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeCalibrations(plan: FloorPlan, samples: SurveySample[]): RoomCalibration[] {
  const byRoom = new Map<string, SurveySample[]>();
  for (const s of samples) {
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }

  const result: RoomCalibration[] = [];
  for (const [roomId, list] of byRoom) {
    if (list.length < 3) continue;
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!room || !plan.aps.length) continue;
    const band = list[0].band;
    const ap = plan.aps.find((a) => a.band === band) ?? plan.aps[0];
    const measuredRssi = median(list.map((s) => s.signal));
    const simulatedRssi = rssiAtPoint(plan, { x: room.x, y: room.y }, ap);
    result.push({
      roomId,
      roomName: room.name,
      measuredRssi,
      simulatedRssi,
      offsetDb: measuredRssi - simulatedRssi,
    });
  }
  return result;
}

export function calibrationMap(calibrations: RoomCalibration[]): Map<string, number> {
  return new Map(calibrations.map((c) => [c.roomId, c.offsetDb]));
}

export function surveyToText(
  samples: SurveySample[],
  calibrations: RoomCalibration[],
): string {
  if (!samples.length && !calibrations.length) return '暂无步行标定数据';
  const lines: string[] = [];
  if (calibrations.length) {
    lines.push(
      '各房间步行标定（实测 vs 仿真）：',
      ...calibrations.map(
        (c) =>
          `  ${c.roomName}: 实测${c.measuredRssi.toFixed(0)}dBm，仿真${c.simulatedRssi.toFixed(0)}dBm，偏差${c.offsetDb >= 0 ? '+' : ''}${c.offsetDb.toFixed(0)}dB`,
      ),
    );
  }
  const weak = calibrations.filter((c) => c.measuredRssi < -70);
  if (weak.length) {
    lines.push(`弱覆盖房间（实测<-70dBm）：${weak.map((c) => c.roomName).join('、')}`);
  }
  if (samples.length) {
    lines.push(`标定采样次数：${samples.length}`);
  }
  return lines.join('\n');
}

export function loadSurveySamples(): SurveySample[] {
  try {
    const raw = localStorage.getItem('luci_ai_planner_survey_samples');
    return raw ? (JSON.parse(raw) as SurveySample[]) : [];
  } catch {
    return [];
  }
}

export function saveSurveySamples(samples: SurveySample[]): void {
  localStorage.setItem('luci_ai_planner_survey_samples', JSON.stringify(samples));
}

export function loadRoomCalibrations(): RoomCalibration[] {
  try {
    const raw = localStorage.getItem('luci_ai_planner_room_calibrations');
    return raw ? (JSON.parse(raw) as RoomCalibration[]) : [];
  } catch {
    return [];
  }
}

export function saveRoomCalibrations(calibrations: RoomCalibration[]): void {
  localStorage.setItem('luci_ai_planner_room_calibrations', JSON.stringify(calibrations));
}

export function loadWalkSurveyPoints(): WalkSurveyPoint[] {
  try {
    const raw = localStorage.getItem('luci_ai_planner_walk_survey_points');
    return raw ? (JSON.parse(raw) as WalkSurveyPoint[]) : [];
  } catch {
    return [];
  }
}

export function saveWalkSurveyPoints(points: WalkSurveyPoint[]): void {
  localStorage.setItem('luci_ai_planner_walk_survey_points', JSON.stringify(points));
}

export function loadSurveyDeviceMac(): string {
  return localStorage.getItem('luci_ai_planner_survey_device_mac') ?? '';
}

export function saveSurveyDeviceMac(mac: string): void {
  localStorage.setItem('luci_ai_planner_survey_device_mac', mac);
}
