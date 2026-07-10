import { useEffect } from 'react';
import { AiPanel } from './components/AiPanel';
import { CanvasEditor } from './components/CanvasEditor';
import { Toolbar } from './components/Toolbar';
import { usePlannerStore } from './store/usePlannerStore';
import './App.css';

export default function App() {
  const stopClientPolling = usePlannerStore((s) => s.stopClientPolling);
  const band = usePlannerStore((s) => s.band);
  const showHeatmap = usePlannerStore((s) => s.showHeatmap);
  const setShowHeatmap = usePlannerStore((s) => s.setShowHeatmap);

  useEffect(() => () => stopClientPolling(), [stopClientPolling]);

  return (
    <div className="app">
      <header className="hero-bar">
        <div className="brand">
          <span className="mark" aria-hidden />
          <div>
            <p className="brand-name">Wi-Fi 布放仿真</p>
            <p className="brand-sub">AI 户型 · 信号热力图</p>
          </div>
        </div>
        <p className="tagline">参考中兴智慧生活布放体验 · 拖动路由查看全屋信号覆盖</p>
      </header>

      <main className="workspace">
        <Toolbar />
        <section className="stage-wrap">
          <div className="stage-header">
            <h2>户型信号图谱</h2>
            <div className="stage-meta">
              <span className="band-badge">{band} GHz 仿真</span>
              <label className="heatmap-toggle">
                <input
                  type="checkbox"
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                />
                热力图
              </label>
            </div>
          </div>
          <div className="stage-body">
            <CanvasEditor />
            <div className="legend">
              <span className="legend-label">信号弱</span>
              <div className="legend-gradient" aria-hidden />
              <span className="legend-label">信号强</span>
            </div>
          </div>
        </section>
        <AiPanel />
      </main>
    </div>
  );
}
