import type { AiFloorPlanPayload, FloorPlan, RouterInfo, WallMaterial, WifiClient } from '../types/floorplan';
import { uid } from '../types/floorplan';

const SYSTEM_PROMPT = `你是户型图解析助手。用户会提供手绘/截图户型，或文字描述。
请只输出 JSON（不要 markdown），结构如下：
{
  "units": "m",
  "scale": { "pixelsPerMeter": 40 },
  "walls": [{ "x1":0,"y1":0,"x2":320,"y2":0,"material":"brick" }],
  "doors": [{ "wallIndex":0, "t":0.5, "width":36 }],
  "windows": [{ "wallIndex":1, "t":0.4, "width":48 }],
  "rooms": [{ "name":"客厅", "x":120, "y":100 }],
  "advice": "一句话覆盖建议"
}
坐标为画布像素，原点左上。material 取 concrete|brick|drywall|glass。
只提取图中可见的墙、门、窗与文字；不要根据路由器信息臆测房间。尽量形成闭合房间，门窗必须落在对应墙上。若无法识别，返回空 walls 数组并在 advice 说明原因。`;

export interface AiSettings {
  apiBase: string;
  apiKey: string;
  model: string;
  /** Whether the model supports vision (image_url in chat). */
  vision: boolean;
}

export interface AiAnalysisResult {
  plan: FloorPlan | null;
  advice: string;
  raw?: string;
}

function defaultVisionForModel(model: string): boolean {
  return /gpt-4o|gpt-4-turbo|gemini|claude-3|qwen-vl|vision|vl-|multimodal|4v/i.test(model);
}

function defaultSettings(): AiSettings {
  const model = localStorage.getItem('luci_ai_planner_model') || 'deepseek-chat';
  const visionStored = localStorage.getItem('luci_ai_planner_vision');
  return {
    apiBase: localStorage.getItem('luci_ai_planner_api_base') || 'https://api.deepseek.com/v1',
    apiKey: localStorage.getItem('luci_ai_planner_api_key') || '',
    model,
    vision: visionStored === null ? defaultVisionForModel(model) : visionStored === '1',
  };
}

export function loadAiSettings(): AiSettings {
  return defaultSettings();
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem('luci_ai_planner_api_base', settings.apiBase);
  localStorage.setItem('luci_ai_planner_api_key', settings.apiKey);
  localStorage.setItem('luci_ai_planner_model', settings.model);
  localStorage.setItem('luci_ai_planner_vision', settings.vision ? '1' : '0');
}

/** Serialize current plan geometry as text for non-vision models. */
export function floorPlanToGeometryNote(plan: FloorPlan): string {
  const lines: string[] = ['当前画布几何描述（像素坐标，原点左上，画布约 960×640）：'];
  if (plan.walls.length) {
    lines.push('墙体：');
    plan.walls.forEach((w, i) => {
      lines.push(
        `  墙${i}: (${Math.round(w.a.x)},${Math.round(w.a.y)})→(${Math.round(w.b.x)},${Math.round(w.b.y)}) 材质=${w.material}`,
      );
    });
  }
  if (plan.openings.length) {
    lines.push('门窗（wallIndex 为墙体序号，t 为 0~1 沿墙位置）：');
    plan.openings.forEach((o) => {
      const wi = plan.walls.findIndex((w) => w.id === o.wallId);
      lines.push(`  ${o.kind}: wallIndex=${wi} t=${o.t.toFixed(2)} width=${o.width}`);
    });
  }
  if (plan.rooms.length) {
    lines.push('房间标签：');
    plan.rooms.forEach((r) => {
      lines.push(`  ${r.name}: (${Math.round(r.x)},${Math.round(r.y)})`);
    });
  }
  if (plan.strokes.length) {
    lines.push('手绘笔画（采样点）：');
    plan.strokes.forEach((s, i) => {
      const pts: string[] = [];
      for (let j = 0; j < s.points.length - 1; j += 16) {
        pts.push(`(${Math.round(s.points[j])},${Math.round(s.points[j + 1])})`);
      }
      lines.push(`  笔画${i}: ${pts.join(' → ')}`);
    });
  }
  if (lines.length === 1) {
    lines.push('（画布为空，请根据用户描述推断合理户型）');
  }
  lines.push(`比例尺: ${plan.pixelsPerMeter} px/m`);
  return lines.join('\n');
}

export function payloadToFloorPlan(payload: AiFloorPlanPayload, fallbackPpm = 40): FloorPlan {
  const walls = (payload.walls || [])
    .filter((w) => [w.x1, w.y1, w.x2, w.y2].every(Number.isFinite))
    .filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 8)
    .map((w) => ({
      id: uid('wall'),
      a: { x: Math.round(w.x1), y: Math.round(w.y1) },
      b: { x: Math.round(w.x2), y: Math.round(w.y2) },
      material: (w.material || 'brick') as WallMaterial,
    }));

  const openings = [
    ...(payload.doors || []).map((d) => ({
      id: uid('door'),
      wallId: walls[d.wallIndex]?.id,
      t: Math.max(0, Math.min(1, d.t)),
      width: Math.max(12, d.width),
      kind: 'door' as const,
    })),
    ...(payload.windows || []).map((w) => ({
      id: uid('window'),
      wallId: walls[w.wallIndex]?.id,
      t: Math.max(0, Math.min(1, w.t)),
      width: Math.max(12, w.width),
      kind: 'window' as const,
    })),
  ].filter((o) => o.wallId);

  return {
    walls,
    openings,
    aps: [],
    rooms: (payload.rooms || [])
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Boolean(r.name?.trim()))
      .map((r) => ({
        id: uid('room'),
        x: Math.round(r.x),
        y: Math.round(r.y),
        name: r.name.trim(),
      })),
    strokes: [],
    pixelsPerMeter: payload.scale?.pixelsPerMeter || fallbackPpm,
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI 未返回 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

/** Demo floor plan when no API key — still lets UI flow work */
export function mockRecognizeFromStrokes(): AiAnalysisResult {
  const payload: AiFloorPlanPayload = {
    units: 'm',
    scale: { pixelsPerMeter: 40 },
    walls: [
      { x1: 80, y1: 80, x2: 520, y2: 80, material: 'brick' },
      { x1: 520, y1: 80, x2: 520, y2: 420, material: 'brick' },
      { x1: 520, y1: 420, x2: 80, y2: 420, material: 'brick' },
      { x1: 80, y1: 420, x2: 80, y2: 80, material: 'brick' },
      { x1: 300, y1: 80, x2: 300, y2: 420, material: 'concrete' },
      { x1: 80, y1: 250, x2: 300, y2: 250, material: 'drywall' },
    ],
    doors: [
      { wallIndex: 4, t: 0.35, width: 36 },
      { wallIndex: 5, t: 0.55, width: 32 },
    ],
    windows: [
      { wallIndex: 0, t: 0.25, width: 60 },
      { wallIndex: 1, t: 0.5, width: 50 },
    ],
    rooms: [
      { name: '客厅', x: 390, y: 240 },
      { name: '主卧', x: 180, y: 150 },
      { name: '次卧', x: 180, y: 330 },
    ],
  };

  return {
    plan: payloadToFloorPlan(payload),
    advice:
      '识别为三开间布局。客厅空间较大，建议主路由放在客厅靠近走廊一侧；主卧与次卧隔墙较多，若信号偏弱可在走廊增加 Mesh 节点。',
  };
}

const GEN_SYSTEM_PROMPT = `你是户型图生成助手。用户会提供一台家用路由器的信息（型号、频段、连接终端数）以及可选的房屋文字描述。
请据此推断一个合理的家庭户型，并只输出 JSON（不要 markdown），结构与解析任务相同：
{
  "units": "m",
  "scale": { "pixelsPerMeter": 40 },
  "walls": [{ "x1":0,"y1":0,"x2":320,"y2":0,"material":"brick" }],
  "doors": [{ "wallIndex":0, "t":0.5, "width":36 }],
  "windows": [{ "wallIndex":1, "t":0.4, "width":48 }],
  "rooms": [{ "name":"客厅", "x":120, "y":100 }],
  "advice": "一句话布放建议"
}
坐标为画布像素（画布约 960x640，原点左上），material 取 concrete|brick|drywall|glass。
房间数量可参考连接终端数量（终端越多房间越多），尽量形成闭合、互不重叠的房间，并给每个房间标注中文名称与中心坐标。`;

function routerInfoToText(info: RouterInfo): string {
  const radios = info.radios
    .map((r) => `${r.band}GHz${r.ssid ? `(${r.ssid})` : ''} 信道${r.channel ?? '?'} 功率${r.txpower ?? '?'}dBm 终端${r.clients ?? 0}`)
    .join('；');
  return [
    `型号: ${info.model}`,
    info.firmware ? `固件: ${info.firmware}` : '',
    `射频: ${radios || '未知'}`,
    `连接终端总数: ${info.clients}`,
    `数据来源: ${info.source === 'openwrt' ? 'OpenWrt 实时' : '演示数据'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Demo floor plan generated from router info when no API key is configured. */
function mockPlanFromRouter(info: RouterInfo): AiAnalysisResult {
  const base = mockRecognizeFromStrokes();
  return {
    plan: base.plan,
    advice: `已根据「${info.model}」推断演示户型（${info.clients} 台终端）。主路由建议放在客厅靠走廊一侧；如户型不准，可用左侧工具手动修改后重新分析。`,
  };
}

/** Generate a floor plan from router info (+ optional home description). */
export async function generateFloorPlan(options: {
  routerInfo: RouterInfo;
  note?: string;
  settings?: AiSettings;
}): Promise<AiAnalysisResult> {
  const settings = options.settings || loadAiSettings();
  if (!settings.apiKey) {
    return mockPlanFromRouter(options.routerInfo);
  }

  const userText = [
    '路由器信息：',
    routerInfoToText(options.routerInfo),
    options.note ? `\n房屋描述：${options.note}` : '',
    '\n请生成户型 JSON。',
  ].join('\n');

  const res = await fetch(`${settings.apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.5,
      messages: [
        { role: 'system', content: GEN_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI 生成失败: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content || '';
  const parsed = extractJson(text) as AiFloorPlanPayload & { advice?: string };
  return {
    plan: payloadToFloorPlan(parsed),
    advice: parsed.advice || '已生成户型，请核对；如不准可手动修改后重新分析。',
    raw: text,
  };
}

export { routerInfoToText };

export { surveyToText } from './survey';

async function chatCompletion(
  settings: AiSettings,
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  temperature: number,
): Promise<string> {
  const res = await fetch(`${settings.apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI 请求失败: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/** Format online clients for AI analysis prompts. */
export function clientsToText(clients: WifiClient[]): string {
  if (!clients.length) return '暂无在线终端';
  return clients
    .map((c) => {
      const name = c.hostname || `MAC··${c.mac.slice(-5)}`;
      const room = c.suspectedRoomName ?? '未标注房间';
      const conf = c.confidence === 'high' ? '高' : c.confidence === 'medium' ? '中' : '低';
      const quality = [
        c.snr != null ? `SNR ${c.snr}dB` : '',
        c.rxRateMbps != null ? `下行 ${c.rxRateMbps.toFixed(0)}Mbps` : '',
        c.txRateMbps != null ? `上行 ${c.txRateMbps.toFixed(0)}Mbps` : '',
      ]
        .filter(Boolean)
        .join('，');
      return `${name} (${c.band}G ${c.signal}dBm${quality ? `，${quality}` : ''}，疑似${room}，置信${conf})`;
    })
    .join('；');
}

export async function recognizeFloorPlan(options: {
  imageDataUrl?: string;
  note?: string;
  geometryNote?: string;
  settings?: AiSettings;
}): Promise<AiAnalysisResult & { usedVision?: boolean }> {
  const settings = options.settings || loadAiSettings();
  if (!settings.apiKey) {
    return mockRecognizeFromStrokes();
  }

  let userText =
    options.note ||
    '请解析户型草图，提取墙、门、窗与房间名称，输出规定 JSON。画布大约 960×640。';
  if (options.geometryNote) {
    userText += `\n\n${options.geometryNote}`;
  }

  const tryVision = settings.vision && !!options.imageDataUrl;

  async function run(withVision: boolean): Promise<string> {
    const userContent: string | Array<Record<string, unknown>> = withVision
      ? [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: options.imageDataUrl } },
        ]
      : userText;
    return chatCompletion(
      settings,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      0.2,
    );
  }

  let text: string;
  let usedVision = false;
  try {
    if (tryVision) {
      text = await run(true);
      usedVision = true;
    } else {
      text = await run(false);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (tryVision && msg.includes('image_url')) {
      text = await run(false);
      usedVision = false;
    } else {
      throw e;
    }
  }

  const parsed = extractJson(text) as AiFloorPlanPayload & { advice?: string };
  return {
    plan: payloadToFloorPlan(parsed),
    advice:
      parsed.advice ||
      (usedVision
        ? '已解析户型，请微调墙体后放置路由并查看热力图。'
        : '已用文字描述识别户型（当前模型不支持识图）。请核对并拖到真实靠墙位置。'),
    raw: text,
    usedVision,
  };
}

export async function analyzeCoverage(options: {
  summary: string;
  settings?: AiSettings;
}): Promise<string> {
  const settings = options.settings || loadAiSettings();
  if (!settings.apiKey) {
    return (
      '【本地演示建议】当前强覆盖区域约占画布较好比例。' +
      '若卧室偏弱：1) 将 AP 移向户型中心或走廊；2) 5GHz 穿墙弱，远房间可改 2.4G 或加 Mesh；' +
      '3) 避免路由器塞进弱电箱角落。配置 API Key 后可获得针对你户型的详细分析。'
    );
  }

  const res = await fetch(`${settings.apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            '你是家庭 Wi-Fi 布放顾问。根据户型与覆盖统计，用简洁中文给出摆放、频段、Mesh 建议，分点不超过 6 条。',
        },
        { role: 'user', content: options.summary },
      ],
    }),
  });

  if (!res.ok) throw new Error(`AI 分析失败: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '暂无建议';
}
