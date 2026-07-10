import { create } from 'zustand';
import {
  analyzeCoverage,
  floorPlanToGeometryNote,
  generateFloorPlan,
  loadAiSettings,
  recognizeFloorPlan,
  routerInfoToText,
  clientsToText,
  saveAiSettings,
  type AiSettings,
} from '../lib/ai';
import {
  applyWalkSurveyToHeatmap,
  computeHeatmap,
  estimateClientLocations,
  roomSignalsWithCalibration,
  summarizeCoverage,
  type HeatmapResult,
} from '../lib/heatmap';
import { fetchAssociatedClients, fetchRouterInfo } from '../lib/openwrt';
import {
  computeCalibrations,
  loadRoomCalibrations,
  loadSurveyDeviceMac,
  loadSurveySamples,
  loadWalkSurveyPoints,
  median,
  saveRoomCalibrations,
  saveSurveyDeviceMac,
  saveSurveySamples,
  saveWalkSurveyPoints,
  surveyToText,
} from '../lib/survey';
import type {
  AccessPoint,
  FloorPlan,
  Opening,
  Point,
  RoomCalibration,
  RoomLabel,
  RouterInfo,
  Stroke,
  SurveySample,
  Tool,
  Wall,
  WallMaterial,
  WalkSurveyPoint,
  WifiClient,
} from '../types/floorplan';
import { uid } from '../types/floorplan';

const CANVAS_W = 960;
const CANVAS_H = 640;
const CLIENT_POLL_MS = 5000;
const SURVEY_POLL_MS = 2000;
const WALK_CAPTURE_INTERVAL_MS = 1000;
const WALK_CAPTURE_SAMPLE_COUNT = 5;

let clientPollTimer: ReturnType<typeof setInterval> | null = null;
let walkCaptureTimer: ReturnType<typeof setInterval> | null = null;
let walkCaptureReading = false;
let visibilityBound = false;

interface WalkSurveyCapture {
  x: number;
  y: number;
  band: AccessPoint['band'];
  signals: number[];
}

const emptyPlan = (): FloorPlan => ({
  walls: [],
  openings: [],
  aps: [],
  rooms: [],
  strokes: [],
  pixelsPerMeter: 40,
});

interface PlannerState {
  tool: Tool;
  material: WallMaterial;
  band: AccessPoint['band'];
  showHeatmap: boolean;
  plan: FloorPlan;
  draftWallStart: Point | null;
  activeStroke: number[] | null;
  sourceFloorPlanImage: string | null;
  heatmap: HeatmapResult | null;
  aiSettings: AiSettings;
  aiBusy: boolean;
  aiAdvice: string;
  status: string;
  canvasWidth: number;
  canvasHeight: number;
  routerInfo: RouterInfo | null;
  routerBusy: boolean;
  clients: WifiClient[];
  clientsBusy: boolean;
  clientPolling: boolean;
  surveyActive: boolean;
  surveyMode: 'room' | 'walk' | null;
  surveyDeviceMac: string;
  surveySamples: SurveySample[];
  roomCalibrations: RoomCalibration[];
  walkSurveyPoints: WalkSurveyPoint[];
  walkCapture: WalkSurveyCapture | null;

  setTool: (tool: Tool) => void;
  setMaterial: (m: WallMaterial) => void;
  setBand: (b: AccessPoint['band']) => void;
  setShowHeatmap: (v: boolean) => void;
  setPixelsPerMeter: (v: number) => void;
  setAiSettings: (s: AiSettings) => void;
  setStatus: (s: string) => void;
  setSourceFloorPlanImage: (image: string | null) => void;

  addWall: (a: Point, b: Point) => void;
  setDraftWallStart: (p: Point | null) => void;
  addOpening: (kind: 'door' | 'window', wallId: string, t: number) => void;
  addAp: (x: number, y: number) => void;
  moveAp: (id: string, x: number, y: number) => void;
  addRoom: (x: number, y: number, name?: string) => void;
  beginStroke: (x: number, y: number) => void;
  appendStroke: (x: number, y: number) => void;
  endStroke: () => void;
  eraseAt: (x: number, y: number) => void;
  clearPlan: () => void;
  loadDemo: () => void;
  replacePlan: (plan: FloorPlan) => void;
  recomputeHeatmap: () => void;
  runAiRecognize: (imageDataUrl?: string) => Promise<void>;
  runAiAnalyze: () => Promise<void>;
  fetchRouterInfo: () => Promise<void>;
  refreshClients: () => Promise<void>;
  startClientPolling: () => void;
  stopClientPolling: () => void;
  generatePlanFromRouter: (note?: string) => Promise<void>;
  setSurveyDeviceMac: (mac: string) => void;
  startSurvey: () => void;
  startWalkSurvey: () => void;
  stopSurvey: () => void;
  recordSurveySample: (roomId: string) => void;
  recordWalkSurveyPoint: (point: Point) => void;
  applySurveyCalibration: () => void;
  clearSurvey: () => void;
  clearWalkSurvey: () => void;
}

/** Auto-place the router AP near the bottom interior wall (typical weak-box / wall mount). */
function apFromRouter(plan: FloorPlan, info: RouterInfo | null): AccessPoint {
  let x = CANVAS_W / 2;
  let y = CANVAS_H / 2;
  if (plan.walls.length) {
    const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const inset = Math.min(48, plan.pixelsPerMeter * 0.5);
    x = (minX + maxX) / 2;
    y = maxY - inset;
  }
  const radio = info?.radios.find((r) => r.band === '5') ?? info?.radios[0];
  return {
    id: uid('ap'),
    x,
    y,
    label: info ? info.model.replace(/\s*\(.*\)$/, '') : 'AP1',
    power: radio?.txpower ?? 20,
    band: radio?.band ?? '5',
    role: 'main',
  };
}

function refreshHeatmap(
  plan: FloorPlan,
  show: boolean,
  walkSurveyPoints: WalkSurveyPoint[] = loadWalkSurveyPoints(),
): HeatmapResult | null {
  if (!show) return null;
  const heatmap = computeHeatmap(plan, CANVAS_W, CANVAS_H, 16);
  return heatmap ? applyWalkSurveyToHeatmap(plan, heatmap, walkSurveyPoints) : null;
}

function withEstimatedClients(
  plan: FloorPlan,
  clients: WifiClient[],
  calibrations: RoomCalibration[],
): WifiClient[] {
  return estimateClientLocations(plan, clients, calibrations);
}

function restartClientPolling(surveyActive: boolean): void {
  if (clientPollTimer) {
    clearInterval(clientPollTimer);
    clientPollTimer = null;
  }
  const state = usePlannerStore.getState();
  if (!state.routerInfo || (typeof document !== 'undefined' && document.hidden)) {
    return;
  }
  const ms = surveyActive ? SURVEY_POLL_MS : CLIENT_POLL_MS;
  clientPollTimer = setInterval(() => {
    void usePlannerStore.getState().refreshClients();
  }, ms);
}

function bindVisibilityPause(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    const state = usePlannerStore.getState();
    if (document.hidden) {
      state.stopClientPolling();
    } else if (state.routerInfo) {
      state.startClientPolling();
    }
  });
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  tool: 'wall',
  material: 'brick',
  band: '5',
  showHeatmap: true,
  plan: emptyPlan(),
  draftWallStart: null,
  activeStroke: null,
  sourceFloorPlanImage: null,
  heatmap: null,
  aiSettings: loadAiSettings(),
  aiBusy: false,
  aiAdvice: '绘制或手绘户型，点击「AI 识别户型」；放置路由器后可查看信号图谱并让 AI 分析。',
  status: '第一步：点击「获取路由信息」，从 OpenWrt 读取路由器数据（未连接路由时使用演示数据）',
  canvasWidth: CANVAS_W,
  canvasHeight: CANVAS_H,
  routerInfo: null,
  routerBusy: false,
  clients: [],
  clientsBusy: false,
  clientPolling: false,
  surveyActive: false,
  surveyMode: null,
  surveyDeviceMac: loadSurveyDeviceMac(),
  surveySamples: loadSurveySamples(),
  roomCalibrations: loadRoomCalibrations(),
  walkSurveyPoints: loadWalkSurveyPoints(),
  walkCapture: null,

  setTool: (tool) => set({ tool, draftWallStart: null, status: toolHint(tool) }),
  setMaterial: (material) => set({ material }),
  setBand: (band) => {
    const plan = {
      ...get().plan,
      aps: get().plan.aps.map((ap) => ({ ...ap, band })),
    };
    set({ band, plan, heatmap: refreshHeatmap(plan, get().showHeatmap) });
  },
  setShowHeatmap: (showHeatmap) =>
    set({ showHeatmap, heatmap: refreshHeatmap(get().plan, showHeatmap) }),
  setPixelsPerMeter: (pixelsPerMeter) => {
    const plan = { ...get().plan, pixelsPerMeter };
    set({ plan, heatmap: refreshHeatmap(plan, get().showHeatmap) });
  },
  setAiSettings: (aiSettings) => {
    saveAiSettings(aiSettings);
    set({ aiSettings });
  },
  setStatus: (status) => set({ status }),
  setSourceFloorPlanImage: (sourceFloorPlanImage) => set({ sourceFloorPlanImage }),

  addWall: (a, b) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 8) return;
    const wall: Wall = { id: uid('wall'), a, b, material: get().material };
    const plan = { ...get().plan, walls: [...get().plan.walls, wall] };
    set({ plan, draftWallStart: null, heatmap: refreshHeatmap(plan, get().showHeatmap) });
  },
  setDraftWallStart: (draftWallStart) => set({ draftWallStart }),

  addOpening: (kind, wallId, t) => {
    const opening: Opening = {
      id: uid(kind),
      wallId,
      t,
      width: kind === 'door' ? 36 : 48,
      kind,
    };
    const plan = { ...get().plan, openings: [...get().plan.openings, opening] };
    set({ plan, heatmap: refreshHeatmap(plan, get().showHeatmap) });
  },

  addAp: (x, y) => {
    const existing = get().plan.aps.length;
    const ap: AccessPoint = {
      id: uid('ap'),
      x,
      y,
      label: existing === 0 ? '主路由' : `Mesh${existing}`,
      power: 20,
      band: get().band,
      role: existing === 0 ? 'main' : 'node',
      nodeId: existing === 0 ? undefined : `node${existing}`,
    };
    const plan = { ...get().plan, aps: [...get().plan.aps, ap] };
    set({ plan, heatmap: refreshHeatmap(plan, get().showHeatmap), status: '已放置路由器，请拖到真实靠墙位置' });
  },

  moveAp: (id, x, y) => {
    const plan = {
      ...get().plan,
      aps: get().plan.aps.map((ap) => (ap.id === id ? { ...ap, x, y } : ap)),
    };
    set({
      plan,
      heatmap: refreshHeatmap(plan, get().showHeatmap),
      clients: withEstimatedClients(plan, get().clients, get().roomCalibrations),
    });
  },

  addRoom: (x, y, name = '房间') => {
    const room: RoomLabel = { id: uid('room'), x, y, name };
    const plan = { ...get().plan, rooms: [...get().plan.rooms, room] };
    set({ plan });
  },

  beginStroke: (x, y) => set({ activeStroke: [x, y] }),
  appendStroke: (x, y) => {
    const s = get().activeStroke;
    if (!s) return;
    set({ activeStroke: [...s, x, y] });
  },
  endStroke: () => {
    const points = get().activeStroke;
    if (!points || points.length < 4) {
      set({ activeStroke: null });
      return;
    }
    const stroke: Stroke = { id: uid('stroke'), points, color: '#0f766e' };
    const plan = { ...get().plan, strokes: [...get().plan.strokes, stroke] };
    set({ plan, activeStroke: null });
  },

  eraseAt: (x, y) => {
    const plan = get().plan;
    const hitAp = plan.aps.find((ap) => Math.hypot(ap.x - x, ap.y - y) < 18);
    if (hitAp) {
      const next = { ...plan, aps: plan.aps.filter((a) => a.id !== hitAp.id) };
      set({ plan: next, heatmap: refreshHeatmap(next, get().showHeatmap) });
      return;
    }
    const hitRoom = plan.rooms.find((r) => Math.hypot(r.x - x, r.y - y) < 28);
    if (hitRoom) {
      set({ plan: { ...plan, rooms: plan.rooms.filter((r) => r.id !== hitRoom.id) } });
      return;
    }
    const hitOpening = plan.openings.find((o) => {
      const wall = plan.walls.find((w) => w.id === o.wallId);
      if (!wall) return false;
      const px = wall.a.x + (wall.b.x - wall.a.x) * o.t;
      const py = wall.a.y + (wall.b.y - wall.a.y) * o.t;
      return Math.hypot(px - x, py - y) < 20;
    });
    if (hitOpening) {
      const next = { ...plan, openings: plan.openings.filter((o) => o.id !== hitOpening.id) };
      set({ plan: next, heatmap: refreshHeatmap(next, get().showHeatmap) });
      return;
    }
    const hitWall = plan.walls.find((w) => {
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - w.a.x) * dx + (y - w.a.y) * dy) / len2));
      const px = w.a.x + dx * t;
      const py = w.a.y + dy * t;
      return Math.hypot(px - x, py - y) < 14;
    });
    if (hitWall) {
      const next = {
        ...plan,
        walls: plan.walls.filter((w) => w.id !== hitWall.id),
        openings: plan.openings.filter((o) => o.wallId !== hitWall.id),
      };
      set({ plan: next, heatmap: refreshHeatmap(next, get().showHeatmap) });
      return;
    }
    if (plan.strokes.length) {
      const next = { ...plan, strokes: plan.strokes.slice(0, -1) };
      set({ plan: next });
    }
  },

  clearPlan: () => {
    if (walkCaptureTimer) {
      clearInterval(walkCaptureTimer);
      walkCaptureTimer = null;
    }
    saveWalkSurveyPoints([]);
    set({
      plan: emptyPlan(),
      heatmap: null,
      draftWallStart: null,
      activeStroke: null,
      sourceFloorPlanImage: null,
      walkSurveyPoints: [],
      walkCapture: null,
    });
  },

  loadDemo: () => {
    void get().runAiRecognize();
  },

  replacePlan: (plan) =>
    set({
      plan,
      heatmap: refreshHeatmap(plan, get().showHeatmap),
      clients: withEstimatedClients(plan, get().clients, get().roomCalibrations),
    }),

  recomputeHeatmap: () => set({ heatmap: refreshHeatmap(get().plan, get().showHeatmap) }),

  runAiRecognize: async (imageDataUrl) => {
    set({ aiBusy: true, status: 'AI 正在解析户型…' });
    try {
      const plan = get().plan;
      const result = await recognizeFloorPlan({
        imageDataUrl,
        geometryNote: floorPlanToGeometryNote(plan),
        settings: get().aiSettings,
      });
      if (result.plan) {
        const merged = {
          ...result.plan,
          aps: get().plan.aps,
          pixelsPerMeter: result.plan.pixelsPerMeter || get().plan.pixelsPerMeter,
        };
        const usedVision = 'usedVision' in result && result.usedVision;
        set({
          plan: merged,
          heatmap: refreshHeatmap(merged, get().showHeatmap),
          aiAdvice: result.advice,
          status: !get().aiSettings.apiKey
            ? '已载入演示户型（未配置 API Key）'
            : usedVision
              ? 'AI 识图完成，可继续微调'
              : '已用文字描述识别（当前模型不支持识图），请核对户型',
        });
      } else {
        set({ aiAdvice: result.advice, status: '未能识别有效墙体' });
      }
    } catch (e) {
      set({ status: e instanceof Error ? e.message : '识别失败', aiAdvice: String(e) });
    } finally {
      set({ aiBusy: false });
    }
  },

  runAiAnalyze: async () => {
    const { plan, heatmap, aiSettings, routerInfo, clients, surveySamples, roomCalibrations, walkSurveyPoints } = get();
    if (!plan.aps.length) {
      set({ status: '请先放置至少一个路由器' });
      return;
    }
    set({ aiBusy: true, status: 'AI 正在分析路由位置与房间信号…' });
    try {
      const stats = heatmap ? summarizeCoverage(heatmap) : null;
      const rooms = roomSignalsWithCalibration(plan, roomCalibrations);
      const levelText: Record<string, string> = {
        excellent: '优秀',
        good: '良好',
        weak: '偏弱',
        poor: '较差',
      };
      const summary = [
        routerInfo ? `路由器信息:\n${routerInfoToText(routerInfo)}` : 'AP 由手动放置',
        `墙体数量: ${plan.walls.length}，门窗数量: ${plan.openings.length}`,
        `AP 数量: ${plan.aps.length}，当前频段: ${get().band} GHz，比例尺: ${plan.pixelsPerMeter} px/m`,
        rooms.length
          ? `各房间信号:\n${rooms
              .map((r) => {
                const prediction = r.calibratedRssi ?? r.rssi;
                return `  ${r.name}: ${prediction.toFixed(0)}dBm（${levelText[r.level]}${r.calibratedRssi != null ? '，已步测校准' : '，仿真'}）`;
              })
              .join('\n')}`
          : `房间: ${plan.rooms.map((r) => r.name).join('、') || '未标注'}`,
        stats
          ? `整体覆盖占比 优秀(≥-55dBm): ${(stats.excellent * 100).toFixed(0)}%, 良好: ${(stats.good * 100).toFixed(0)}%, 偏弱: ${(stats.weak * 100).toFixed(0)}%, 较差: ${(stats.poor * 100).toFixed(0)}%`
          : '暂无热力图统计',
        clients.length
          ? `在线终端（实测 RSSI，房间为单 AP 粗估）:\n${clientsToText(clients)}`
          : '暂无在线终端数据',
        surveySamples.length || roomCalibrations.length
          ? `步行标定:\n${surveyToText(surveySamples, roomCalibrations)}`
          : '',
        walkSurveyPoints.length
          ? `全屋巡测：${walkSurveyPoints.length} 个位置点，实测 RSSI 范围 ${Math.min(...walkSurveyPoints.map((point) => point.signal)).toFixed(0)} 到 ${Math.max(...walkSurveyPoints.map((point) => point.signal)).toFixed(0)} dBm`
          : '',
        '请分析路由器在户型中的位置是否合理、各房间信号是否达标，并给出摆放/频段/Mesh 建议。',
      ]
        .filter(Boolean)
        .join('\n');
      const advice = await analyzeCoverage({ summary, settings: aiSettings });
      set({ aiAdvice: advice, status: '分析完成' });
    } catch (e) {
      set({ status: e instanceof Error ? e.message : '分析失败' });
    } finally {
      set({ aiBusy: false });
    }
  },

  fetchRouterInfo: async () => {
    set({ routerBusy: true, status: '正在从 OpenWrt 读取路由器信息…' });
    try {
      const info = await fetchRouterInfo();
      const clients = withEstimatedClients(get().plan, info.clientList, get().roomCalibrations);
      set({
        routerInfo: { ...info, clientList: clients },
        clients,
        band: info.radios.find((r) => r.band === '5')?.band ?? info.radios[0]?.band ?? get().band,
        status:
          info.source === 'openwrt'
            ? `已读取路由器：${info.model}（${info.clients} 台终端）。下一步「AI 生成户型」`
            : `未连接 OpenWrt，使用演示路由：${info.model}。下一步「AI 生成户型」`,
      });
      get().startClientPolling();
    } catch (e) {
      set({ status: e instanceof Error ? e.message : '读取路由器信息失败' });
    } finally {
      set({ routerBusy: false });
    }
  },

  refreshClients: async () => {
    if (get().clientsBusy) return;
    set({ clientsBusy: true });
    try {
      const raw = await fetchAssociatedClients();
      const clients = withEstimatedClients(get().plan, raw, get().roomCalibrations);
      const routerInfo = get().routerInfo;
      set({
        clients,
        routerInfo: routerInfo
          ? {
              ...routerInfo,
              clients: clients.length,
              clientList: clients,
              radios: routerInfo.radios.map((r) => ({
                ...r,
                clients: clients.filter((c) => c.band === r.band).length,
              })),
            }
          : routerInfo,
      });
    } catch {
      // keep previous client list on transient errors
    } finally {
      set({ clientsBusy: false });
    }
  },

  startClientPolling: () => {
    bindVisibilityPause();
    if (clientPollTimer) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    set({ clientPolling: true });
    void get().refreshClients();
    restartClientPolling(get().surveyActive);
  },

  stopClientPolling: () => {
    if (clientPollTimer) {
      clearInterval(clientPollTimer);
      clientPollTimer = null;
    }
    set({ clientPolling: false });
  },

  setSurveyDeviceMac: (mac) => {
    saveSurveyDeviceMac(mac);
    set({ surveyDeviceMac: mac });
  },

  startSurvey: () => {
    if (!get().surveyDeviceMac) {
      set({ status: '请先在标定向导中选择「这是我的手机」' });
      return;
    }
    if (!get().plan.rooms.length) {
      set({ status: '请先用「房间」工具或 AI 生成户型并标注房间' });
      return;
    }
    set({ surveyActive: true, surveyMode: 'room', status: '标定中：走到房间后点击「我在这里」' });
    get().startClientPolling();
    if (clientPollTimer) {
      clearInterval(clientPollTimer);
      clientPollTimer = null;
    }
    restartClientPolling(true);
  },

  startWalkSurvey: () => {
    if (!get().surveyDeviceMac) {
      set({ status: '请先在标定向导中选择「这是我的手机」' });
      return;
    }
    if (!get().plan.aps.length) {
      set({ status: '请先放置路由器并生成热力图' });
      return;
    }
    set({
      surveyActive: true,
      surveyMode: 'walk',
      walkCapture: null,
      status: '全屋巡测中：走到当前位置后，点击户型图自动采集 5 次 RSSI',
    });
    get().startClientPolling();
    if (clientPollTimer) {
      clearInterval(clientPollTimer);
      clientPollTimer = null;
    }
    restartClientPolling(true);
  },

  stopSurvey: () => {
    if (walkCaptureTimer) {
      clearInterval(walkCaptureTimer);
      walkCaptureTimer = null;
    }
    set({ surveyActive: false, surveyMode: null, walkCapture: null });
    if (clientPollTimer) {
      clearInterval(clientPollTimer);
      clientPollTimer = null;
    }
    if (get().routerInfo) {
      restartClientPolling(false);
      set({ clientPolling: true });
    }
  },

  recordSurveySample: (roomId) => {
    const { surveyDeviceMac, plan, clients, band, routerInfo } = get();
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!room) return;
    let client = clients.find((c) => c.mac === surveyDeviceMac);
    if (!client && routerInfo?.source === 'demo') {
      client = {
        mac: surveyDeviceMac,
        hostname: '标定设备',
        signal: -58 + Math.round(Math.random() * 20 - 10),
        band,
        ifname: 'wlan0',
      };
    }
    if (!client) {
      set({ status: '未找到所选设备的 RSSI，请确认手机已连 Wi‑Fi 并刷新终端列表' });
      return;
    }
    const sample: SurveySample = {
      id: uid('survey'),
      roomId,
      roomName: room.name,
      mac: surveyDeviceMac,
      signal: client.signal,
      band: client.band,
      ts: Date.now(),
    };
    const surveySamples = [...get().surveySamples, sample];
    saveSurveySamples(surveySamples);
    set({
      surveySamples,
      status: `已记录「${room.name}」: ${client.signal} dBm`,
    });
  },

  recordWalkSurveyPoint: (point) => {
    const { surveyActive, surveyMode, surveyDeviceMac, clients, band, routerInfo, walkCapture } = get();
    if (!surveyActive || surveyMode !== 'walk') return;
    if (walkCapture) {
      set({ status: `正在采集当前位置（${walkCapture.signals.length}/${WALK_CAPTURE_SAMPLE_COUNT}）` });
      return;
    }
    let client = clients.find((item) => item.mac === surveyDeviceMac);
    if (!client && routerInfo?.source === 'demo') {
      client = {
        mac: surveyDeviceMac,
        hostname: '标定设备',
        signal: -58 + Math.round(Math.random() * 20 - 10),
        band,
        ifname: 'wlan0',
      };
    }
    if (!client) {
      set({ status: '未找到所选手机的 RSSI，请确认其已连接 Wi‑Fi 后重试' });
      return;
    }
    set({
      walkCapture: { x: point.x, y: point.y, band: client.band, signals: [client.signal] },
      status: `正在采集当前位置（1/${WALK_CAPTURE_SAMPLE_COUNT}）`,
    });
    startWalkCaptureTimer();
  },

  applySurveyCalibration: () => {
    const { plan, surveySamples } = get();
    if (!surveySamples.length) {
      set({ status: '尚无标定样本，请先到各房间点击「我在这里」' });
      return;
    }
    const roomCalibrations = computeCalibrations(plan, surveySamples);
    if (!roomCalibrations.length) {
      set({ status: '每个房间至少记录 3 次 RSSI 后才能应用标定' });
      return;
    }
    saveRoomCalibrations(roomCalibrations);
    const clients = withEstimatedClients(plan, get().clients, roomCalibrations);
    set({
      roomCalibrations,
      clients,
      surveyActive: false,
      status: `已应用标定（${roomCalibrations.length} 个房间），终端房间估计已更新`,
    });
    get().stopSurvey();
  },

  clearSurvey: () => {
    if (walkCaptureTimer) {
      clearInterval(walkCaptureTimer);
      walkCaptureTimer = null;
    }
    saveSurveySamples([]);
    saveRoomCalibrations([]);
    set({
      surveySamples: [],
      roomCalibrations: [],
      surveyActive: false,
      surveyMode: null,
      walkCapture: null,
      clients: withEstimatedClients(get().plan, get().clients, []),
      status: '已清除步行标定数据',
    });
  },

  clearWalkSurvey: () => {
    if (walkCaptureTimer) {
      clearInterval(walkCaptureTimer);
      walkCaptureTimer = null;
    }
    saveWalkSurveyPoints([]);
    set({
      walkSurveyPoints: [],
      walkCapture: null,
      heatmap: refreshHeatmap(get().plan, get().showHeatmap),
      status: '已清除全屋巡测数据',
    });
  },

  generatePlanFromRouter: async (note) => {
    let info = get().routerInfo;
    set({ aiBusy: true, status: 'AI 正在根据路由器信息生成户型…' });
    try {
      if (!info) {
        info = await fetchRouterInfo();
        const clients = withEstimatedClients(get().plan, info.clientList, get().roomCalibrations);
        set({ routerInfo: { ...info, clientList: clients }, clients });
        get().startClientPolling();
      }
      const result = await generateFloorPlan({ routerInfo: info, note, settings: get().aiSettings });
      if (result.plan) {
        const ap = apFromRouter(result.plan, info);
        const merged: FloorPlan = {
          ...result.plan,
          aps: [ap],
          pixelsPerMeter: result.plan.pixelsPerMeter || get().plan.pixelsPerMeter,
        };
        set({
          plan: merged,
          band: ap.band,
          heatmap: refreshHeatmap(merged, get().showHeatmap),
          clients: withEstimatedClients(
            merged,
            get().clients.length ? get().clients : info.clientList,
            get().roomCalibrations,
          ),
          aiAdvice: result.advice,
          status: get().aiSettings.apiKey
            ? 'AI 已生成户型并放置路由（默认靠墙侧），请拖到真实位置后点「分析信号」'
            : '已生成演示户型并放置路由（未配置 API Key）；请拖到真实靠墙位置',
        });
      } else {
        set({ aiAdvice: result.advice, status: '未能生成有效户型' });
      }
    } catch (e) {
      set({ status: e instanceof Error ? e.message : '生成失败', aiAdvice: String(e) });
    } finally {
      set({ aiBusy: false });
    }
  },
}));

function startWalkCaptureTimer(): void {
  if (walkCaptureTimer) clearInterval(walkCaptureTimer);
  walkCaptureTimer = setInterval(() => {
    void captureWalkSurveyReading();
  }, WALK_CAPTURE_INTERVAL_MS);
}

async function captureWalkSurveyReading(): Promise<void> {
  if (walkCaptureReading) return;
  walkCaptureReading = true;
  try {
    const initialState = usePlannerStore.getState();
    if (!initialState.walkCapture || !initialState.surveyActive || initialState.surveyMode !== 'walk') {
      if (walkCaptureTimer) clearInterval(walkCaptureTimer);
      walkCaptureTimer = null;
      return;
    }
    await initialState.refreshClients();
    const state = usePlannerStore.getState();
    const capture = state.walkCapture;
    if (!capture || !state.surveyActive || state.surveyMode !== 'walk') {
      if (walkCaptureTimer) clearInterval(walkCaptureTimer);
      walkCaptureTimer = null;
      return;
    }

    let client = state.clients.find((item) => item.mac === state.surveyDeviceMac);
    if (!client && state.routerInfo?.source === 'demo') {
      client = {
        mac: state.surveyDeviceMac,
        hostname: '标定设备',
        signal: -58 + Math.round(Math.random() * 20 - 10),
        band: state.band,
        ifname: 'wlan0',
      };
    }
    if (!client) return;

    const signals = [...capture.signals, client.signal];
    if (signals.length < WALK_CAPTURE_SAMPLE_COUNT) {
      usePlannerStore.setState({
        walkCapture: { ...capture, signals },
        status: `正在采集当前位置（${signals.length}/${WALK_CAPTURE_SAMPLE_COUNT}）`,
      });
      return;
    }

    const point: WalkSurveyPoint = {
      id: uid('walk'),
      x: capture.x,
      y: capture.y,
      mac: state.surveyDeviceMac,
      signal: median(signals),
      band: capture.band,
      sampleCount: signals.length,
      ts: Date.now(),
    };
    const walkSurveyPoints = [...state.walkSurveyPoints, point];
    saveWalkSurveyPoints(walkSurveyPoints);
    usePlannerStore.setState({
      walkSurveyPoints,
      walkCapture: null,
      heatmap: refreshHeatmap(state.plan, state.showHeatmap, walkSurveyPoints),
      status: `已记录巡测点 ${walkSurveyPoints.length}：${point.signal.toFixed(0)} dBm`,
    });
    if (walkCaptureTimer) clearInterval(walkCaptureTimer);
    walkCaptureTimer = null;
  } finally {
    walkCaptureReading = false;
  }
}

function toolHint(tool: Tool): string {
  switch (tool) {
    case 'wall':
      return '点击两点绘制墙体，可在右侧选择墙体材质';
    case 'door':
      return '点击靠近墙体的位置放置门';
    case 'window':
      return '点击靠近墙体的位置放置窗';
    case 'draw':
      return '按住鼠标自由手绘，完成后可用 AI 识别';
    case 'ap':
      return '点击画布放置路由器，可拖动调整';
    case 'room':
      return '点击标注房间名称';
    case 'eraser':
      return '点击删除墙/门窗/AP/房间，或撤销最后一笔手绘';
    default:
      return '拖动路由器节点调整位置';
  }
}
