import { create } from 'zustand';
import { analyzeCoverage, loadAiSettings, recognizeFloorPlan, saveAiSettings, type AiSettings } from '../lib/ai';
import { computeHeatmap, summarizeCoverage, type HeatmapResult } from '../lib/heatmap';
import type {
  AccessPoint,
  FloorPlan,
  Opening,
  Point,
  RoomLabel,
  Stroke,
  Tool,
  Wall,
  WallMaterial,
} from '../types/floorplan';
import { uid } from '../types/floorplan';

const CANVAS_W = 960;
const CANVAS_H = 640;

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
  heatmap: HeatmapResult | null;
  aiSettings: AiSettings;
  aiBusy: boolean;
  aiAdvice: string;
  status: string;
  canvasWidth: number;
  canvasHeight: number;

  setTool: (tool: Tool) => void;
  setMaterial: (m: WallMaterial) => void;
  setBand: (b: AccessPoint['band']) => void;
  setShowHeatmap: (v: boolean) => void;
  setPixelsPerMeter: (v: number) => void;
  setAiSettings: (s: AiSettings) => void;
  setStatus: (s: string) => void;

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
}

function refreshHeatmap(plan: FloorPlan, show: boolean): HeatmapResult | null {
  if (!show) return null;
  return computeHeatmap(plan, CANVAS_W, CANVAS_H, 16);
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  tool: 'wall',
  material: 'brick',
  band: '5',
  showHeatmap: true,
  plan: emptyPlan(),
  draftWallStart: null,
  activeStroke: null,
  heatmap: null,
  aiSettings: loadAiSettings(),
  aiBusy: false,
  aiAdvice: '绘制或手绘户型，点击「AI 识别户型」；放置路由器后可查看信号图谱并让 AI 分析。',
  status: '选择「墙」工具，点击两点绘制墙体',
  canvasWidth: CANVAS_W,
  canvasHeight: CANVAS_H,

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
    const ap: AccessPoint = {
      id: uid('ap'),
      x,
      y,
      label: `AP${get().plan.aps.length + 1}`,
      power: 20,
      band: get().band,
    };
    const plan = { ...get().plan, aps: [...get().plan.aps, ap] };
    set({ plan, heatmap: refreshHeatmap(plan, get().showHeatmap), status: '已放置路由器，可拖动调整位置' });
  },

  moveAp: (id, x, y) => {
    const plan = {
      ...get().plan,
      aps: get().plan.aps.map((ap) => (ap.id === id ? { ...ap, x, y } : ap)),
    };
    set({ plan, heatmap: refreshHeatmap(plan, get().showHeatmap) });
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

  clearPlan: () => set({ plan: emptyPlan(), heatmap: null, draftWallStart: null, activeStroke: null }),

  loadDemo: () => {
    void get().runAiRecognize();
  },

  replacePlan: (plan) => set({ plan, heatmap: refreshHeatmap(plan, get().showHeatmap) }),

  recomputeHeatmap: () => set({ heatmap: refreshHeatmap(get().plan, get().showHeatmap) }),

  runAiRecognize: async (imageDataUrl) => {
    set({ aiBusy: true, status: 'AI 正在解析户型…' });
    try {
      const result = await recognizeFloorPlan({
        imageDataUrl,
        settings: get().aiSettings,
      });
      if (result.plan) {
        const merged = {
          ...result.plan,
          aps: get().plan.aps,
          pixelsPerMeter: result.plan.pixelsPerMeter || get().plan.pixelsPerMeter,
        };
        set({
          plan: merged,
          heatmap: refreshHeatmap(merged, get().showHeatmap),
          aiAdvice: result.advice,
          status: get().aiSettings.apiKey ? 'AI 识别完成，可继续微调' : '已载入演示户型（未配置 API Key）',
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
    const { plan, heatmap, aiSettings } = get();
    if (!plan.aps.length) {
      set({ status: '请先放置至少一个路由器' });
      return;
    }
    set({ aiBusy: true, status: 'AI 正在分析覆盖…' });
    try {
      const stats = heatmap ? summarizeCoverage(heatmap) : null;
      const summary = [
        `墙体数量: ${plan.walls.length}`,
        `门窗数量: ${plan.openings.length}`,
        `AP 数量: ${plan.aps.length}，频段: ${get().band} GHz`,
        `比例尺: ${plan.pixelsPerMeter} px/m`,
        `房间: ${plan.rooms.map((r) => r.name).join('、') || '未标注'}`,
        stats
          ? `覆盖占比 优秀(≥-55dBm): ${(stats.excellent * 100).toFixed(0)}%, 良好: ${(stats.good * 100).toFixed(0)}%, 偏弱: ${(stats.weak * 100).toFixed(0)}%, 较差: ${(stats.poor * 100).toFixed(0)}%`
          : '暂无热力图统计',
      ].join('\n');
      const advice = await analyzeCoverage({ summary, settings: aiSettings });
      set({ aiAdvice: advice, status: '分析完成' });
    } catch (e) {
      set({ status: e instanceof Error ? e.message : '分析失败' });
    } finally {
      set({ aiBusy: false });
    }
  },
}));

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
