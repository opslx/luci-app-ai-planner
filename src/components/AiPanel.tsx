import { useState } from 'react';
import { usePlannerStore } from '../store/usePlannerStore';
import { roomSignals, summarizeCoverage } from '../lib/heatmap';
import type { SignalLevel } from '../types/floorplan';

const LEVEL_META: Record<SignalLevel, { label: string; color: string }> = {
  excellent: { label: '优秀', color: '#dc2626' },
  good: { label: '良好', color: '#eab308' },
  weak: { label: '偏弱', color: '#16a34a' },
  poor: { label: '较差', color: '#1d4ed8' },
};

export function AiPanel() {
  const {
    aiSettings,
    setAiSettings,
    aiAdvice,
    aiBusy,
    heatmap,
    plan,
    status,
    routerInfo,
    routerBusy,
    fetchRouterInfo,
    generatePlanFromRouter,
    runAiAnalyze,
  } = usePlannerStore();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const stats = heatmap ? summarizeCoverage(heatmap) : null;
  const rooms = roomSignals(plan);
  const busy = aiBusy || routerBusy;

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <h3>AI 布放向导</h3>
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

      <div className="wizard">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void fetchRouterInfo()}>
          {routerBusy ? '读取中…' : '① 获取路由信息'}
        </button>

        {routerInfo ? (
          <div className="router-card">
            <div className="router-top">
              <strong>{routerInfo.model}</strong>
              <span className={`src ${routerInfo.source}`}>
                {routerInfo.source === 'openwrt' ? 'OpenWrt 实时' : '演示数据'}
              </span>
            </div>
            {routerInfo.firmware ? <p className="router-fw">{routerInfo.firmware}</p> : null}
            <ul className="radio-list">
              {routerInfo.radios.map((r, i) => (
                <li key={i}>
                  <span className="band">{r.band}G</span>
                  {r.ssid ? <span>{r.ssid}</span> : null}
                  <span>信道 {r.channel ?? '—'}</span>
                  <span>{r.txpower ?? '—'}dBm</span>
                  <span>{r.clients ?? 0} 终端</span>
                </li>
              ))}
            </ul>
            <p className="router-clients">连接终端总数：{routerInfo.clients}</p>
          </div>
        ) : null}

        <label className="field">
          <span>房屋描述（可选，供 AI 生成参考）</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：三室两厅，约 110㎡，客厅在南侧"
          />
        </label>

        <button
          type="button"
          className="btn"
          disabled={busy || !routerInfo}
          onClick={() => void generatePlanFromRouter(note.trim() || undefined)}
        >
          {aiBusy ? '生成中…' : '② AI 生成户型'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !plan.aps.length}
          onClick={() => void runAiAnalyze()}
        >
          ③ AI 分析位置与信号
        </button>
        <p className="hint">户型不准？用左侧工具手动修改后可重新点击 ③ 分析。</p>
      </div>

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

      {rooms.length ? (
        <div className="room-signals">
          <h4>各房间信号</h4>
          <ul>
            {rooms.map((r) => (
              <li key={r.roomId}>
                <span className="dot" style={{ background: LEVEL_META[r.level].color }} />
                <span className="rname">{r.name}</span>
                <span className="rrssi">{r.rssi.toFixed(0)} dBm</span>
                <span className="rlevel">{LEVEL_META[r.level].label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
        <p className="hint">生成户型或放置路由后将显示覆盖占比</p>
      )}

      <div className={`advice ${aiBusy ? 'busy' : ''}`}>
        <h4>{aiBusy ? '思考中…' : '建议'}</h4>
        <p>{aiAdvice}</p>
      </div>

      <p className="status">{status}</p>
    </aside>
  );
}
