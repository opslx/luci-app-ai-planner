# AGENTS.md

## Cursor Cloud specific instructions

场图 Changtu is a **frontend-only** Vite + React + TypeScript single-page app (Konva canvas editor + Zustand store). There is no backend, database, or Docker; all Wi-Fi heatmap simulation runs locally in the browser.

- Node/tooling: Node 22 is available and works with the pinned Vite 8 / TypeScript 6 / React 19 stack. Dependencies are plain `npm` (see `package-lock.json`).
- Standard commands live in `package.json` scripts — use those rather than duplicating: `npm run dev` (Vite dev server, defaults to port 5173), `npm run lint` (oxlint), `npm run build` (`tsc -b && vite build`), `npm run preview`.
- The dev server binds to `localhost:5173`; use `npm run dev -- --host` if you need it reachable on the VM's network interface.
- AI features (`AI 识别户型` / `AI 分析覆盖`) call an OpenAI-compatible API and require an API Base + Key entered in the in-app "API 设置" panel (stored only in browser localStorage — no env vars). Without a key the app falls back to local demo logic, so no secrets are needed to run or test the core flow.
- Quick end-to-end smoke test with no API key: open the app, click "载入演示户型" to load a demo floor plan, place a 路由 (router/AP) on the canvas, and confirm the colored Wi-Fi heatmap + coverage stats render.
