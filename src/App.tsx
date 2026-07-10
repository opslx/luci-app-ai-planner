import { AiPanel } from './components/AiPanel';
import { CanvasEditor } from './components/CanvasEditor';
import { Toolbar } from './components/Toolbar';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="hero-bar">
        <div className="brand">
          <span className="mark" aria-hidden />
          <div>
            <p className="brand-name">场图 Changtu</p>
            <p className="brand-sub">AI 户型布放 · 信号图谱</p>
          </div>
        </div>
        <p className="tagline">拖墙门窗或手绘户型，识别平面后仿真全屋 Wi‑Fi 覆盖</p>
      </header>

      <main className="workspace">
        <Toolbar />
        <section className="stage-wrap">
          <CanvasEditor />
          <div className="legend">
            <span>弱</span>
            <div className="legend-gradient" />
            <span>强</span>
          </div>
        </section>
        <AiPanel />
      </main>
    </div>
  );
}
