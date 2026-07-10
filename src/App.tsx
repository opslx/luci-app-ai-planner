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
            <p className="brand-name">luci-app-ai-planner</p>
            <p className="brand-sub">AI 户型布放 · 信号图谱</p>
          </div>
        </div>
        <p className="tagline">从 OpenWrt 读取路由信息 → AI 生成户型并分析全屋 Wi‑Fi 覆盖 → 手动微调</p>
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
