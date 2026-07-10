import { useState } from 'react';
import { usePlannerStore } from '../store/usePlannerStore';
import { summarizeCoverage } from '../lib/heatmap';

export function AiPanel() {
  const { aiSettings, setAiSettings, aiAdvice, aiBusy, heatmap, plan, status, loadDemo } =
    usePlannerStore();
  const [open, setOpen] = useState(false);

  const stats = heatmap ? summarizeCoverage(heatmap) : null;

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <h3>AI 分析</h3>
        <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
          {open ? '收起设置' : 'API 设置'}
        </button>
      </div>

      {open ? (
        <div className="settings">
          <label className="field">
            <span>API Base</span>
            <input
              value={aiSettings.apiBase}
              onChange={(e) => setAiSettings({ ...aiSettings, apiBase: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={aiSettings.apiKey}
              onChange={(e) => setAiSettings({ ...aiSettings, apiKey: e.target.value })}
              placeholder="未填写则使用本地演示识别"
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={aiSettings.model}
              onChange={(e) => setAiSettings({ ...aiSettings, model: e.target.value })}
              placeholder="deepseek-chat / gpt-4o-mini"
            />
          </label>
        </div>
      ) : null}

      <div className="stats">
        <div>
          <strong>{plan.walls.length}</strong>
          <span>墙体</span>
        </div>
        <div>
          <strong>{plan.openings.length}</strong>
          <span>门窗</span>
        </div>
        <div>
          <strong>{plan.aps.length}</strong>
          <span>路由</span>
        </div>
      </div>

      {stats ? (
        <div className="coverage">
          <div className="bar">
            <i style={{ width: `${stats.excellent * 100}%`, background: '#dc2626' }} />
            <i style={{ width: `${stats.good * 100}%`, background: '#eab308' }} />
            <i style={{ width: `${stats.weak * 100}%`, background: '#22c55e' }} />
            <i style={{ width: `${stats.poor * 100}%`, background: '#1d4ed8' }} />
          </div>
          <p>
            优秀 {(stats.excellent * 100).toFixed(0)}% · 良好 {(stats.good * 100).toFixed(0)}% · 偏弱{' '}
            {(stats.weak * 100).toFixed(0)}% · 较差 {(stats.poor * 100).toFixed(0)}%
          </p>
        </div>
      ) : (
        <p className="hint">放置路由器后将显示覆盖占比</p>
      )}

      <div className={`advice ${aiBusy ? 'busy' : ''}`}>
        <h4>{aiBusy ? '思考中…' : '建议'}</h4>
        <p>{aiAdvice}</p>
      </div>

      <button type="button" className="btn ghost full" onClick={() => void loadDemo()}>
        载入演示户型
      </button>

      <p className="status">{status}</p>
    </aside>
  );
}
