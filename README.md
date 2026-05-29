<div align="center">

# AI Investment Manager

**智能投资助手 · AI-Powered Investment Management Platform**

[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://github.com/Einsphoton/AI_Investment_Manager/pkgs/container/ai-investment-manager)
![Python](https://img.shields.io/badge/python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)
![React](https://img.shields.io/badge/React-18-61dafb)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 📖 项目简介 | Introduction

AI Investment Manager 是一个基于 AI 的智能投资管理平台，结合了大语言模型（LLM）和多种分析技能，为用户提供全面的投资决策支持。

AI Investment Manager is an AI-powered investment management platform that combines Large Language Models (LLM) with multiple analytical skills to provide comprehensive investment decision support.

---

## 🏗️ 项目架构 | Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)            │
│   Dashboard │ Assets │ Targets │ OCR │ Settings       │
└───────────────────────────┬─────────────────────────┘
                            │ HTTP / REST API
┌───────────────────────────▼─────────────────────────┐
│              Backend (FastAPI + Python)               │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│  │  AI      │ │  Data    │ │  OCR Service      │   │
│  │  Service │ │  Source  │ │  (Tushare, etc.)  │   │
│  ├──────────┤ ├──────────┤ ├───────────────────┤   │
│  │  Agent   │ │  Market  │ │  Database         │   │
│  │  Harness │ │  Calendar│ │  (SQLite/SQLAlch.)│   │
│  └────┬─────┘ └──────────┘ └───────────────────┘   │
│       │                                              │
│  ┌────▼─────────────────────────────────────────┐   │
│  │              Skill System                      │   │
│  │  Technical │ Fundamental │ Macro │ Target     │   │
│  │  Quant │ ESG │ REITs │ Convertible Bond ...   │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 技术栈 | Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Ant Design, Recharts |
| **Backend** | Python 3.12, FastAPI, SQLAlchemy, APScheduler |
| **AI** | OpenAI API, Custom Agent Framework with Skill System |
| **Database** | SQLite (dev), PostgreSQL-ready via SQLAlchemy |
| **OCR** | Custom OCR service for financial documents |
| **Container** | Docker, Docker Compose |

---

## 🚀 快速开始 | Quick Start

### Docker 部署（推荐） | Docker (Recommended)

```bash
# 拉取镜像 | Pull image
docker pull ghcr.io/einsphoton/ai-investment-manager:latest

# 运行 | Run
docker run -d \
  --name ai-investment-manager \
  -p 8000:8000 \
  -v ./data:/app/data \
  -e OPENAI_API_KEY=your_key_here \
  ghcr.io/einsphoton/ai-investment-manager:latest
```

或者使用 docker-compose：

```bash
# 克隆仓库 | Clone the repo
git clone https://github.com/Einsphoton/AI_Investment_Manager.git
cd AI_Investment_Manager

# 启动 | Start
./start.sh   # macOS / Linux
# 或 .\start.bat   # Windows
```

### 本地开发 | Local Development

```bash
# 后端 | Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 前端 | Frontend (另一个终端 | another terminal)
cd frontend
npm install
npm run dev
```

前端开发服务器默认运行在 `http://localhost:5173`，API 请求会自动代理到 `http://localhost:8000`。

---

## ⚙️ 环境变量 | Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | OpenAI API Key |
| `DATABASE_URL` | No | `sqlite:///data/investment.db` | Database connection URL |
| `TUSHARE_TOKEN` | No | - | Tushare API Token (Chinese market data) |

---

## 🧠 技能系统 | Skill System

AI Agent 通过可插拔的技能系统支持多种分析能力：

| 技能模块 | Description |
|----------|-------------|
| **Technical Analysis** | 技术指标分析（均线、MACD、RSI 等） |
| **Fundamental Analysis** | 基本面分析（财务数据、估值指标） |
| **Macro Analysis** | 宏观经济分析 |
| **Target Analysis** | 投资标的分析 |
| **Recommendation** | 投资建议生成 |
| **Quant Strategy** | 量化策略回测与评估 |
| **Risk Control** | 风险评估与控制 |
| **ESG Analysis** | ESG 可持续投资分析 |
| **Convertible Bond** | 可转债分析 |
| **REITs Analysis** | REITs 不动产投资分析 |
| **Sector Rotation** | 行业轮动分析 |
| **IPO Analysis** | 新股分析 |
| **News Sentiment** | 新闻情绪分析 |
| **Global Markets** | 全球市场分析 |
| **Dividend Analysis** | 分红分析 |
| **Industry Chain** | 产业链分析 |
| **M&A Analysis** | 并购分析 |

---

## 📦 项目结构 | Project Structure

```
AI_Investment_Manager/
├── backend/
│   ├── main.py                 # FastAPI 入口
│   ├── ai_service.py           # AI 服务
│   ├── data_source.py          # 行情数据源（新浪/腾讯/Yahoo等）
│   ├── database.py             # 数据库配置
│   ├── models.py               # SQLAlchemy 模型
│   ├── schemas.py              # Pydantic 模型
│   ├── stream_events.py        # SSE 实时事件流（持仓/标的/投资建议）
│   ├── parallel_executor.py    # 并行执行引擎（ThreadPool + 批量调度）
│   ├── market_calendar.py      # 交易日历
│   ├── ocr_service.py          # OCR 识别服务
│   ├── agent/                  # AI Agent 框架
│   │   ├── harness.py          # Agent 核心引擎
│   │   ├── personality.py      # 人格配置
│   │   ├── skill.py            # 技能基类
│   │   ├── skills/             # 核心技能
│   │   └── marketplace_skills/ # 市场技能
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── main.tsx            # 入口
│   │   ├── App.tsx             # 根组件 + 路由
│   │   ├── pages/              # 页面
│   │   │   ├── Dashboard.tsx      # 仪表盘（含一键AI分析）
│   │   │   ├── Assets.tsx         # 资产管理
│   │   │   ├── Targets.tsx        # 标的池
│   │   │   ├── InvestmentAdvice.tsx  # AI 投资建议
│   │   │   ├── Ocr.tsx            # OCR 识别
│   │   │   ├── Settings.tsx       # 设置
│   │   │   └── SkillMarket.tsx    # 技能市场
│   │   ├── components/
│   │   │   ├── Layout.tsx            # 布局
│   │   │   ├── AIProgressOverlay.tsx # AI 分析进度浮窗
│   │   │   └── ErrorBoundary.tsx     # 错误边界
│   │   ├── stores/
│   │   │   └── AIWorkContext.tsx      # AI 工作状态管理（SSE/进度/子任务）
│   │   └── api/
│   │       └── index.ts             # API 客户端
│   └── package.json
├── data/                    # SQLite 数据目录
├── Dockerfile               # 多阶段构建
├── docker-compose.yml       # Docker 编排
└── .github/workflows/       # CI/CD
```

---

## ⚡ 并行执行引擎 | Parallel Execution Engine

系统支持将耗时的数据获取任务（行情、基本面）自动并行化，显著提升一键分析速度。

| 组件 | Description |
|------|-------------|
| **`parallel_executor.py`** | 基于 `ThreadPoolExecutor` 的并行调度引擎，支持超时控制、批量处理 |
| **`stream_events.py`** | SSE (Server-Sent Events) 实时事件流，为前端推送进度、思考过程、日志 |
| **`AIWorkContext.tsx`** | React Context + Reducer 状态管理，驱动进度浮窗的实时更新 |
| **`AIProgressOverlay.tsx`** | 悬浮进度面板，支持并行子任务展示、实时日志、手动取消 |

### 一键 AI 分析流程 | One-Click AI Analysis Flow

```
开始分析 ──▶ 并行资产分析 ──▶ 并行标的分析 ──▶ 并行投资建议 ──▶ 完成
              (SSE 流)          (SSE 流)          (SSE 流)
                │                  │                  │
                ▼                  ▼                  ▼
       实时进度浮窗 ◀────── AIWorkContext 状态管理 ◀──────
```

### 优化效果 | Performance Improvements

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 5 持仓 + 15 标的一键分析 | 60-100s（串行行情请求） | 8-15s（5 线程并行 + 去重缓存） |
| 标的分析（30 标的） | 30-60s（串行行情请求） | 5-10s（并行行情请求） |
| AI 投资建议生成 | OpenAI 无限等待 | 120s 超时保护 |

---

## 🔌 SSE 实时流接口 | Real-time Streaming API

系统通过 Server-Sent Events (SSE) 提供实时分析流：

| 端点 | Method | Description |
|------|--------|-------------|
| `/api/analysis/run-stream` | POST | 资产分析实时流 |
| `/api/targets/ai-analyze-stream` | POST | 标的分析实时流 |
| `/api/investment-advice/run-stream` | POST | 投资建议实时流 |

每个 SSE 流会推送以下事件类型：
- `progress` — 进度百分比 (0-100)
- `thinking` — AI 当前思考内容
- `log` — 操作日志（带 tag 分类）
- `complete` — 任务完成（含结果 JSON）
- `error` — 错误信息
---

## 🤝 贡献指南 | Contributing

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交修改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 📄 许可证 | License

MIT License - see [LICENSE](LICENSE) file for details.
