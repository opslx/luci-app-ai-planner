# luci-app-ai-planner · Wi‑Fi AI 户型布放

在浏览器里绘制/手绘户型平面图，用 AI 解析墙门窗结构，并仿真房间内 Wi‑Fi 信号图谱（类似中兴「AI 布放仿真」体验）。

## 功能

- **OpenWrt 路由信息**：作为 LuCI 插件运行时，通过 ubus 读取路由器型号、频段、连接终端等信息（未连接路由时使用演示数据）
- **AI 生成户型**：根据路由信息（及可选的房屋描述）由 AI 推断并生成户型平面
- **位置与信号分析**：自动放置路由并分析各房间信号强弱，给出摆放 / Mesh / 频段建议
- **手动微调**：户型不准时可用绘制工具（墙 / 门 / 窗 / 房间 / 手绘）手动修改后重新分析
- **信号图谱**：基于距离衰减 + 穿墙损耗的本地热力仿真
- **OpenAI 兼容接口**：DeepSeek / OpenAI 等，未配置 Key 时可用演示逻辑

## AI 布放向导（推荐流程）

1. **① 获取路由信息**：从 OpenWrt（ubus）读取路由器数据
2. **② AI 生成户型**：AI 据此生成户型并自动放置路由
3. **③ AI 分析位置与信号**：查看各房间信号与布放建议
4. 若户型不准，用左侧工具手动修改后再次点击 ③ 分析

## 快速开始

```bash
npm install
npm run dev
```

打开终端提示的本地地址即可。

```bash
npm run build
npm run preview
```

## 使用流程

1. 用「墙 / 门 / 窗」拼出户型，或用「手绘」画草图  
2. 点击 **AI 识别户型**（无 API Key 会载入演示平面）  
3. 用「路由」放置 AP，拖动查看热力图变化  
4. 点击 **AI 分析覆盖** 获取中文建议  

右侧 **API 设置** 可填写：

| 项 | 示例 |
|----|------|
| API Base | `https://api.deepseek.com/v1` 或 `https://api.openai.com/v1` |
| Model | `deepseek-chat` / `gpt-4o-mini` |
| API Key | 你的密钥（仅存浏览器 localStorage） |

> 多模态识图需要模型支持 vision；纯文本模型仍可用于覆盖分析。无 Key 时走本地演示逻辑。

## 技术栈

- Vite + React + TypeScript  
- Konva / react-konva 画布编辑  
- Zustand 状态  
- 本地射频简化模型（FSPL + 材质损耗）

## 作为 OpenWrt / LuCI 插件

`openwrt/` 目录提供了将本应用打包为 `luci-app-ai-planner` 的脚手架：

- `openwrt/Makefile`：LuCI 包定义，把构建产物安装到 `/www/luci-app-ai-planner/`
- `openwrt/root/usr/share/rpcd/acl.d/luci-app-ai-planner.json`：授予页面通过 ubus 读取
  `system board/info`、`network.wireless status`、`iwinfo` 的权限（`src/lib/openwrt.ts` 依赖此 ACL）
- `openwrt/root/usr/share/luci/menu.d/…` 与 `…/resources/view/ai-planner/app.js`：LuCI 菜单入口（内嵌 SPA）

打包流程（需 OpenWrt SDK / buildroot）：

```bash
npm ci && npm run build
cp -r dist/* openwrt/htdocs/
# 将 openwrt/ 放入 SDK 的 package/luci-app-ai-planner/ 后：
make package/luci-app-ai-planner/compile V=s
```

> 浏览器直接访问（非路由环境）时，ubus 不可达，`fetchRouterInfo` 会自动回退到演示路由数据。

### OpenWrt 18.06 / ImmortalWrt

18.06 使用 **Lua controller + 模板** 注册菜单（已内置），详见 [`openwrt/README.md`](openwrt/README.md) 手动部署步骤。终端 RSSI 在缺少 `iwinfo` ubus 时会回退解析 `network.wireless status`。

### 后续可扩展

- 从 `iwinfo` 关联客户端读取真实 RSSI 做校准
- 路由端代理 AI API，避免浏览器暴露 Key
- Mesh 多节点自动导入位置

## 说明

热力图为**布放仿真**，不是精确场强测量。墙体材质、比例尺会影响结果，请按实际微调。

## License

MIT
