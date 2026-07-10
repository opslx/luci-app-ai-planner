# luci-app-ai-planner · Wi‑Fi AI 户型布放

在浏览器里绘制/手绘户型平面图，用 AI 解析墙门窗结构，并仿真房间内 Wi‑Fi 信号图谱（类似中兴「AI 布放仿真」体验）。

## 功能

- **组件拼装**：拖绘墙体，点击放置门/窗，标注房间
- **手绘草图**：自由笔画后交给 AI 识别
- **信号图谱**：基于距离衰减 + 穿墙损耗的本地热力仿真
- **AI 分析**：识别户型结构，并给出摆放 / Mesh / 频段建议
- **OpenAI 兼容接口**：DeepSeek / OpenAI 等，未配置 Key 时可用演示户型

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

## 后续可接 OpenWrt

本仓库是 **Web MVP**。后续可做成 `luci-app-ai-planner`：

- 从 `iwinfo` / 关联客户端读取真实 RSSI 做校准  
- 路由端代理 AI API，避免浏览器暴露 Key  
- Mesh 多节点自动导入位置

## 说明

热力图为**布放仿真**，不是精确场强测量。墙体材质、比例尺会影响结果，请按实际微调。

## License

MIT
