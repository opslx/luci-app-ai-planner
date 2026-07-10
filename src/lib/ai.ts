import type { AiFloorPlanPayload, FloorPlan, RouterInfo, WallMaterial } from '../types/floorplan';
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
尽量形成闭合房间。若无法识别，返回空 walls 数组并在 advice 说明原因。`;

export interface AiSettings {
  apiBase: string;
  apiKey: string;
  model: string;
}

export interface AiAnalysisResult {
  plan: FloorPlan | null;
  advice: string;
  raw?: string;
}

function defaultSettings(): AiSettings {
  return {
    apiBase: localStorage.getItem('luci_ai_planner_api_base') || 'https://api.deepseek.com/v1',
    apiKey: localStorage.getItem('luci_ai_planner_api_key') || '',
    model: localStorage.getItem('luci_ai_planner_model') || 'deepseek-chat',
  };
}

export function loadAiSettings(): AiSettings {
  return defaultSettings();
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem('luci_ai_planner_api_base', settings.apiBase);
  localStorage.setItem('luci_ai_planner_api_key', settings.apiKey);
  localStorage.setItem('luci_ai_planner_model', settings.model);
}

export function payloadToFloorPlan(payload: AiFloorPlanPayload, fallbackPpm = 40): FloorPlan {
  const walls = (payload.walls || []).map((w) => ({
    id: uid('wall'),
    a: { x: w.x1, y: w.y1 },
    b: { x: w.x2, y: w.y2 },
    material: (w.material || 'brick') as WallMaterial,
  }));

  const openings = [
    ...(payload.doors || []).map((d) => ({
      id: uid('door'),
      wallId: walls[d.wallIndex]?.id,
      t: d.t,
      width: d.width,
      kind: 'door' as const,
    })),
    ...(payload.windows || []).map((w) => ({
      id: uid('window'),
      wallId: walls[w.wallIndex]?.id,
      t: w.t,
      width: w.width,
      kind: 'window' as const,
    })),
  ].filter((o) => o.wallId);

  return {
    walls,
    openings,
    aps: [],
    rooms: (payload.rooms || []).map((r) => ({
      id: uid('room'),
      x: r.x,
      y: r.y,
      name: r.name,
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

export async function recognizeFloorPlan(options: {
  imageDataUrl?: string;
  note?: string;
  settings?: AiSettings;
}): Promise<AiAnalysisResult> {
  const settings = options.settings || loadAiSettings();
  if (!settings.apiKey) {
    return mockRecognizeFromStrokes();
  }

  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        options.note ||
        '请解析这张户型草图，提取墙、门、窗与房间名称，输出规定 JSON。画布大约 900x600。',
    },
  ];

  if (options.imageDataUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: options.imageDataUrl },
    });
  }

  const res = await fetch(`${settings.apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI 请求失败: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content || '';
  const parsed = extractJson(text) as AiFloorPlanPayload & { advice?: string };
  return {
    plan: payloadToFloorPlan(parsed),
    advice: parsed.advice || '已解析户型，请微调墙体后放置路由并查看热力图。',
    raw: text,
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
