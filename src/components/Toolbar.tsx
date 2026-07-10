import type { Tool, WallMaterial } from '../types/floorplan';
import { usePlannerStore } from '../store/usePlannerStore';

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'select', label: '选择' },
  { id: 'wall', label: '墙' },
  { id: 'door', label: '门' },
  { id: 'window', label: '窗' },
  { id: 'draw', label: '手绘' },
  { id: 'ap', label: '路由' },
  { id: 'room', label: '房间' },
  { id: 'eraser', label: '擦除' },
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
    showHeatmap,
    plan,
    aiBusy,
    setTool,
    setMaterial,
    setBand,
    setShowHeatmap,
    setPixelsPerMeter,
    clearPlan,
    runAiRecognize,
    runAiAnalyze,
  } = usePlannerStore();

  const exportCanvasImage = async () => {
    const stage = document.querySelector('#floorplan-stage canvas');
    if (!(stage instanceof HTMLCanvasElement)) {
      await runAiRecognize();
      return;
    }
    await runAiRecognize(stage.toDataURL('image/png'));
  };

  return (
    <aside className="toolbar">
      <div className="tool-block">
        <h3>绘制工具</h3>
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tool === t.id ? 'tool active' : 'tool'}
              onClick={() => setTool(t.id)}
            >
              {t.label}
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
        <h3>射频</h3>
        <div className="chip-row">
          {(['2.4', '5', '6'] as const).map((b) => (
            <button
              key={b}
              type="button"
              className={band === b ? 'chip active' : 'chip'}
              onClick={() => setBand(b)}
            >
              {b} GHz
            </button>
          ))}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={(e) => setShowHeatmap(e.target.checked)}
          />
          显示信号图谱
        </label>
        <label className="field">
          <span>比例尺 (px/m)</span>
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
        <button type="button" className="btn primary" disabled={aiBusy} onClick={() => void exportCanvasImage()}>
          AI 识别户型
        </button>
        <button type="button" className="btn" disabled={aiBusy} onClick={() => void runAiAnalyze()}>
          AI 分析覆盖
        </button>
        <button type="button" className="btn ghost" onClick={() => clearPlan()}>
          清空画布
        </button>
      </div>
    </aside>
  );
}
