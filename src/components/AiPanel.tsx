import { useState } from 'react';
import { usePlannerStore } from '../store/usePlannerStore';
import {
  roomSignalsWithCalibration,
  SIGNAL_LEVEL_COLORS,
  SIGNAL_LEVEL_LABELS,
  summarizeCoverage,
} from '../lib/heatmap';
import type { ClientConfidence } from '../types/floorplan';

const CONF_META: Record<ClientConfidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

function maskMac(mac: string): string {
  const parts = mac.split(':');
  if (parts.length < 2) return mac;
  return `··:${parts.slice(-2).join(':')}`;
}

function rssiBarWidth(rssi: number): string {
  const pct = Math.max(8, Math.min(100, ((rssi + 90) / 50) * 100));
  return `${pct}%`;
}

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
    clients,
    clientsBusy,
    clientPolling,
    surveyActive,
    surveyMode,
    surveyDeviceMac,
    surveySamples,
    roomCalibrations,
    walkSurveyPoints,
    walkCapture,
    fetchRouterInfo,
    generatePlanFromRouter,
    runAiAnalyze,
    refreshClients,
    setSurveyDeviceMac,
    startSurvey,
    startWalkSurvey,
    stopSurvey,
    recordSurveySample,
    applySurveyCalibration,
    clearSurvey,
    clearWalkSurvey,
  } = usePlannerStore();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const stats = heatmap ? summarizeCoverage(heatmap) : null;
  const rooms = roomSignalsWithCalibration(plan, roomCalibrations);
  const busy = aiBusy || routerBusy;
  const calibratedRoomIds = new Set(roomCalibrations.map((c) => c.roomId));

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <h3>布放向导</h3>
        <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : 'API 设置'}
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
              placeholder="未填写则使用本地演示"
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={aiSettings.model}
              onChange={(e) => setAiSettings({ ...aiSettings, model: e.target.value })}
              onBlur={(e) => {
                const model = e.target.value.trim();
                if (localStorage.getItem('luci_ai_planner_vision') === null) {
                  setAiSettings({
                    ...aiSettings,
                    model,
                    vision: /gpt-4o|gemini|claude-3|qwen-vl|vision|vl-/i.test(model),
                  });
                } else {
                  setAiSettings({ ...aiSettings, model });
                }
              }}
              placeholder="deepseek-chat"
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={aiSettings.vision}
              onChange={(e) => setAiSettings({ ...aiSettings, vision: e.target.checked })}
            />
            支持识图（Vision）
          </label>
          <p className="hint">DeepSeek 等纯文本模型请关闭；GPT-4o 等可开启。</p>
        </div>
      ) : null}

      <div className="wizard">
        <button type="button" className="btn primary full" disabled={busy} onClick={() => void fetchRouterInfo()}>
          {routerBusy ? '读取中…' : '① 获取路由信息'}
        </button>

        {routerInfo ? (
          <div className="router-card">
            <div className="router-top">
              <strong>{routerInfo.model}</strong>
              <span className={`src ${routerInfo.source}`}>
                {routerInfo.source === 'openwrt' ? '实时' : '演示'}
              </span>
            </div>
            {routerInfo.firmware ? <p className="router-fw">{routerInfo.firmware}</p> : null}
            <ul className="radio-list">
              {routerInfo.radios.map((r, i) => (
                <li key={i}>
                  <span className="band">{r.band}G</span>
                  {r.ssid ? <span>{r.ssid}</span> : null}
                  <span>{r.clients ?? 0} 台</span>
                </li>
              ))}
            </ul>
            <p className="router-clients">在线 {routerInfo.clients} 台设备</p>
          </div>
        ) : null}

        <label className="field">
          <span>房屋描述（生成草案，可选）</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="三室两厅，约 110㎡"
          />
        </label>

        <button
          type="button"
          className="btn full"
          disabled={busy || !routerInfo}
          onClick={() => void generatePlanFromRouter(note.trim() || undefined)}
        >
          {aiBusy ? '生成中…' : '② AI 生成户型'}
        </button>
        <button
          type="button"
          className="btn full"
          disabled={busy || !plan.aps.length}
          onClick={() => void runAiAnalyze()}
        >
          ③ 分析信号覆盖
        </button>
      </div>

      {plan.aps.length > 0 ? (
        <div className="mesh-summary">
          <h4 className="section-title">Mesh 节点</h4>
          <ul>
            {plan.aps.map((ap) => (
              <li key={ap.id}>
                <span className="band-pill">{ap.role === 'main' ? '主' : '节点'}</span>
                <strong>{ap.label}</strong>
                <span>{ap.band}G · {ap.power}dBm</span>
              </li>
            ))}
          </ul>
          <p className="hint">左侧「路由」工具可放置第二个 Mesh 节点（仿真用）。</p>
        </div>
      ) : null}

      {plan.aps.length > 0 && routerInfo ? (
        <div className="survey-panel">
          <h4 className="section-title">步行测量</h4>
          <p className="hint">手机连 Wi‑Fi 后，选择本机；全屋巡测会从 OpenWrt 连续读取 RSSI 并校正热力图。</p>
          {clients.length ? (
            <label className="field">
              <span>标定设备</span>
              <select
                value={surveyDeviceMac}
                onChange={(e) => setSurveyDeviceMac(e.target.value)}
              >
                <option value="">选择终端…</option>
                {clients.map((c) => (
                  <option key={c.mac} value={c.mac}>
                    {c.hostname || maskMac(c.mac)} ({c.signal} dBm)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="hint">暂无在线终端，请先刷新或连接 Wi‑Fi。</p>
          )}
          <div className="survey-actions">
            {!surveyActive ? (
              <>
                <button type="button" className="btn full" disabled={!surveyDeviceMac || !plan.rooms.length} onClick={() => startSurvey()}>
                  房间标定
                </button>
                <button type="button" className="btn primary full" disabled={!surveyDeviceMac} onClick={() => startWalkSurvey()}>
                  开始全屋巡测
                </button>
              </>
            ) : (
              <button type="button" className="btn ghost full" onClick={() => stopSurvey()}>
                停止测量
              </button>
            )}
            <button type="button" className="btn full" disabled={surveyMode === 'walk' || !surveySamples.length} onClick={() => applySurveyCalibration()}>
              应用标定
            </button>
            <button type="button" className="btn ghost full" onClick={() => clearSurvey()}>
              清除房间标定
            </button>
            <button type="button" className="btn ghost full" disabled={!walkSurveyPoints.length} onClick={() => clearWalkSurvey()}>
              清除巡测点
            </button>
          </div>
          {surveyActive && surveyMode === 'walk' ? (
            <p className="survey-live">
              巡测中 · 在户型图点击当前位置{walkCapture ? ` · 采集 ${walkCapture.signals.length}/5` : ' · 等待选点'}
            </p>
          ) : null}
          {walkSurveyPoints.length ? <p className="hint">已融合 {walkSurveyPoints.length} 个巡测点到热力图。</p> : null}
          {surveyMode !== 'walk' ? <div className="survey-rooms">
            {plan.rooms.map((room) => {
              const count = surveySamples.filter((s) => s.roomId === room.id).length;
              const cal = roomCalibrations.find((c) => c.roomId === room.id);
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`survey-room-btn ${calibratedRoomIds.has(room.id) ? 'done' : ''}`}
                  disabled={!surveyActive || surveyMode !== 'room'}
                  onClick={() => recordSurveySample(room.id)}
                >
                  <span>{room.name}</span>
                  {count > 0 ? <span className="survey-count">{count} 次</span> : null}
                  {cal ? <span className="survey-rssi">{cal.measuredRssi.toFixed(0)} dBm</span> : null}
                </button>
              );
            })}
          </div> : null}
        </div>
      ) : null}

      {rooms.length ? (
        <div>
          <h4 className="section-title">房间信号</h4>
          <div className="room-grid">
            {rooms.map((r) => {
              const weak = r.measuredRssi != null && r.measuredRssi < -70;
              return (
                <div
                  key={r.roomId}
                  className={`room-card ${r.level}${weak ? ' weak-measured' : ''}`}
                >
                  <p className="room-card-name">{r.name}</p>
                  <p className="room-card-rssi" style={{ color: SIGNAL_LEVEL_COLORS[r.level] }}>
                    {r.calibratedRssi != null ? `校准预测 ${r.calibratedRssi.toFixed(0)}` : `仿真 ${r.rssi.toFixed(0)}`} dBm
                  </p>
                  {r.measuredRssi != null ? (
                    <p className="room-card-measured">
                      实测 {r.measuredRssi.toFixed(0)} dBm
                      {r.offsetDb != null ? (
                        <span> ({r.offsetDb >= 0 ? '+' : ''}{r.offsetDb.toFixed(0)} dB)</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="room-card-level">{SIGNAL_LEVEL_LABELS[r.level]}</p>
                  <div className="room-card-bar">
                    <i style={{ width: rssiBarWidth(r.rssi), background: SIGNAL_LEVEL_COLORS[r.level] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {stats ? (
        <div className="coverage">
          <h4>全屋覆盖</h4>
          <div className="bar">
            <i style={{ width: `${stats.poor * 100}%`, background: '#2563eb' }} />
            <i style={{ width: `${stats.weak * 100}%`, background: '#38bdf8' }} />
            <i style={{ width: `${stats.good * 100}%`, background: '#f97316' }} />
            <i style={{ width: `${stats.excellent * 100}%`, background: '#ef4444' }} />
          </div>
          <div className="coverage-legend">
            <span><i style={{ background: '#ef4444' }} />优秀 {(stats.excellent * 100).toFixed(0)}%</span>
            <span><i style={{ background: '#f97316' }} />良好 {(stats.good * 100).toFixed(0)}%</span>
            <span><i style={{ background: '#38bdf8' }} />偏弱 {(stats.weak * 100).toFixed(0)}%</span>
            <span><i style={{ background: '#2563eb' }} />较差 {(stats.poor * 100).toFixed(0)}%</span>
          </div>
        </div>
      ) : null}

      {routerInfo ? (
        <div className="client-list">
          <div className="client-head">
            <h4>在线终端</h4>
            <div className="client-actions">
              {clientPolling ? <span className="live-dot" title="轮询中" /> : null}
              <button
                type="button"
                className="linkish"
                disabled={clientsBusy}
                onClick={() => void refreshClients()}
              >
                {clientsBusy ? '…' : '刷新'}
              </button>
            </div>
          </div>
          {clients.length ? (
            <ul>
              {clients.map((c) => (
                <li key={c.mac}>
                  <div className="client-row">
                    <strong>{c.hostname || maskMac(c.mac)}</strong>
                    <span className="band-pill">{c.band}G</span>
                  </div>
                  <div className="client-meta">
                    <span style={{ color: SIGNAL_LEVEL_COLORS[c.signal >= -55 ? 'excellent' : c.signal >= -67 ? 'good' : c.signal >= -75 ? 'weak' : 'poor'] }}>
                      {c.signal} dBm
                    </span>
                    <span>{c.suspectedRoomName ?? '—'}</span>
                    {c.snr != null ? <span>SNR {c.snr} dB</span> : null}
                    {c.rxRateMbps != null ? <span>↓{c.rxRateMbps.toFixed(0)}M</span> : null}
                    {c.txRateMbps != null ? <span>↑{c.txRateMbps.toFixed(0)}M</span> : null}
                    {c.confidence ? <span>置信{CONF_META[c.confidence]}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">暂无关联终端</p>
          )}
        </div>
      ) : null}

      <div className={`advice ${aiBusy ? 'busy' : ''}`}>
        <h4>{aiBusy ? '分析中…' : '布放建议'}</h4>
        <p>{aiAdvice}</p>
      </div>

      <p className="status">{status}</p>
    </aside>
  );
}
