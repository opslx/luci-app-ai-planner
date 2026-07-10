import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { Tool, WallMaterial } from '../types/floorplan';
import { usePlannerStore } from '../store/usePlannerStore';

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: 'select', label: '选择', icon: '◎' },
  { id: 'wall', label: '墙', icon: '▬' },
  { id: 'door', label: '门', icon: '⌐' },
  { id: 'window', label: '窗', icon: '▭' },
  { id: 'draw', label: '手绘', icon: '✎' },
  { id: 'ap', label: '路由', icon: '◉' },
  { id: 'room', label: '房间', icon: '□' },
  { id: 'eraser', label: '擦除', icon: '✕' },
];

const MATERIALS: Array<{ id: WallMaterial; label: string }> = [
  { id: 'concrete', label: '混凝土' },
  { id: 'brick', label: '砖墙' },
  { id: 'drywall', label: '石膏板' },
  { id: 'glass', label: '玻璃' },
];

export function Toolbar() {
  const {
    tool,
    material,
    band,
    plan,
    aiBusy,
    setTool,
    setMaterial,
    setBand,
    setPixelsPerMeter,
    clearPlan,
    runAiRecognize,
    runAiAnalyze,
    setSourceFloorPlanImage,
  } = usePlannerStore();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const exportCanvasImage = async () => {
    const stage = document.querySelector('#floorplan-stage canvas');
    if (!(stage instanceof HTMLCanvasElement)) {
      await runAiRecognize();
      return;
    }
    await runAiRecognize(stage.toDataURL('image/png'));
  };

  const recognizeUploadedImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) {
      window.alert('户型图请控制在 8MB 以内');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imageDataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!imageDataUrl) return;
      setSourceFloorPlanImage(imageDataUrl);
      void runAiRecognize(imageDataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <aside className="toolbar">
      <div className="tool-block">
        <h3>绘制</h3>
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tool === t.id ? 'tool active' : 'tool'}
              onClick={() => setTool(t.id)}
              title={t.label}
            >
              <span aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tool-block">
        <h3>墙体材质</h3>
        <div className="chip-row">
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={material === m.id ? 'chip active' : 'chip'}
              onClick={() => setMaterial(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tool-block">
        <h3>频段</h3>
        <div className="chip-row">
          {(['2.4', '5', '6'] as const).map((b) => (
            <button
              key={b}
              type="button"
              className={band === b ? 'chip active' : 'chip'}
              onClick={() => setBand(b)}
            >
              {b}G
            </button>
          ))}
        </div>
        <label className="field">
          <span>比例尺 px/m</span>
          <input
            type="number"
            min={10}
            max={120}
            value={plan.pixelsPerMeter}
            onChange={(e) => setPixelsPerMeter(Number(e.target.value) || 40)}
          />
        </label>
      </div>

      <div className="tool-block actions">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={recognizeUploadedImage}
        />
        <button type="button" className="btn primary full" disabled={aiBusy} onClick={() => imageInputRef.current?.click()}>
          上传户型图识别
        </button>
        <button type="button" className="btn primary full" disabled={aiBusy} onClick={() => void exportCanvasImage()}>
          识别当前画布
        </button>
        <button type="button" className="btn full" disabled={aiBusy} onClick={() => void runAiAnalyze()}>
          AI 分析覆盖
        </button>
        <button type="button" className="btn ghost full" onClick={() => clearPlan()}>
          清空画布
        </button>
      </div>
    </aside>
  );
}
