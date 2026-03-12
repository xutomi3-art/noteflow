# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Noteflow is an AI-powered knowledge base tool inspired by NotebookLM. Users create notebooks, upload documents (PDF, DOCX, PPTX, TXT, MD), and interact through AI Q&A with citation traceability. Key differentiators: notebook-level sharing without team setup, Chinese LLM (Qwen), private deployment.

Full product spec: `PRD_KnowledgeBase_v4.md`

## Architecture

**Two-service architecture** behind an Nginx reverse proxy:

- **Frontend** (`frontend/`): Next.js 15 (App Router) + Tailwind CSS + Zustand
- **Backend** (`backend/`): Python FastAPI
- **Nginx** routes `/api/*` → FastAPI:8000, `/*` → Next.js:3000 — no CORS needed

Communication: REST + SSE (Server-Sent Events) for streaming. No WebSocket — SSE handles both chat streaming and document processing status.

### Data Flow: Document → AI Answer

```
Upload → FastAPI → local storage
  → MinerU (PDF/DOCX/PPTX → Markdown)
  → RAGFlow (chunking → Qwen embedding → Elasticsearch index)
  → status SSE push to frontend

Query → FastAPI → RAGFlow retrieval (hybrid: 70% vector + 30% BM25)
  → Qwen-Plus generates answer with retrieved chunks
  → SSE stream tokens + citations to frontend
```

RAGFlow is used **only for retrieval** — LLM generation is handled directly via Qwen API in FastAPI for full control over prompts, citation format, and streaming.

### Key Integration Points

- `backend/services/ragflow_client.py` — RAGFlow HTTP API wrapper (dataset CRUD, document upload, retrieval)
- `backend/services/mineru_client.py` — MinerU document parsing
- `backend/services/qwen_client.py` — Qwen API for LLM generation + embedding
- `backend/services/document_pipeline.py` — Orchestrates upload → parse → index → ready

### State Management (Frontend)

Zustand stores with cross-panel coordination:
- `authStore` — JWT token, user profile, refresh logic
- `notebookStore` — notebook list, current notebook, sources
- `chatStore` — messages, streaming state, selected source IDs for scoped queries
- `studioStore` — generated outputs (summary, FAQ, study guide), saved notes

### Auth

Custom JWT issued by FastAPI (not NextAuth). 24h expiry + refresh token rotation. Tokens stored in httpOnly cookies via Nginx.

### Citation Contract

Every AI answer includes inline `[1][2]` markers mapped to:
```typescript
interface Citation {
  index: number;
  sourceId: string;
  filename: string;
  fileType: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md';
  location: { page?: number; slide?: number; paragraph?: number };
  excerpt: string;
}
```
This contract must be preserved end-to-end: MinerU/parser tags chunks with location metadata → RAGFlow preserves it through indexing → retrieval response includes it → FastAPI assembles Citation objects.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, Tailwind CSS, Zustand, TypeScript |
| Backend | Python FastAPI, SQLAlchemy, Alembic, Pydantic |
| RAG Engine | RAGFlow (self-hosted, pinned Docker version) |
| Document Parsing | MinerU (CPU mode) |
| LLM | Qwen-Plus / Qwen-Max via Alibaba Cloud API |
| Embedding | text-embedding-v3 (Alibaba Cloud) |
| Database | PostgreSQL |
| Search | Elasticsearch (bundled with RAGFlow) |
| Reverse Proxy | Nginx |
| Containerization | Docker Compose |

## Development Commands

```bash
# Full stack (Docker Compose)
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose logs -f backend    # Tail backend logs

# Frontend (local dev)
cd frontend && npm install
npm run dev                       # Next.js dev server on :3000
npm run build                     # Production build
npm run lint                      # ESLint

# Backend (local dev)
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8000    # FastAPI dev server
alembic upgrade head                      # Run DB migrations
alembic revision --autogenerate -m "msg"  # Create migration

# Database
docker compose exec postgres psql -U noteflow -d noteflow
```

## Deployment

- **Server**: 10.200.0.112 (Ubuntu 24.04, 16 cores, 16GB RAM, no GPU)
- All services run via Docker Compose behind Nginx
- See `LOGIN.md` for server credentials

## Design Conventions

- **Frontend style**: Apple-inspired — clean, generous whitespace, rounded corners, subtle shadows, system font stack (SF Pro style)
- **API format**: `{ "data": ... }` for success, `{ "error": { "code": "...", "message": "..." } }` for errors
- **Real-time**: SSE only (no WebSocket) for both chat streaming and status updates

## Phase Boundaries

- **Phase 1** ✅: Personal notebooks, PDF/DOCX/PPTX/TXT/MD upload, AI Q&A with citations, Studio (Summary/FAQ/Study Guide/Saved Notes)
- **Phase 2** ✅: Excel/CSV support (DuckDB + dual-track RAG), notebook sharing (Owner/Editor/Viewer roles, invite links)
- **Phase 3** ✅: Mind Map, Podcast, PPT generation (python-pptx + Presenton), mobile responsive, inline PDF viewer
- **Phase 4** ✅: Admin Panel (dashboard/users/LLM config/system/logs/usage), DeepSeek R1 thinking mode, conversation memory, resizable panels, paste image, delete notebook UI
- **Phase 5** (planned): Google SSO (needs domain), Presenton GPU PPT, Vanna.ai, Chart Understanding, Subscription plans, Private deployment, Open API

## 🔄 Autonomous Workflow（自主工作流 — 核心）

### 工作循环

执行任务时遵循以下循环，**不要停下来问我**：

1. **理解**: 读取相关代码、测试、SCRATCHPAD.md，理解当前状态
2. **计划**: 在思考过程中制定方案（不需要写出来给我看）
3. **实现**: 写代码，完整实现，不留 TODO
4. **验证**: 依次运行 → lint → type check → tests
5. **修复**: 如果任何检查失败，自行分析和修复，回到步骤 4
6. **重复步骤 4-5**，直到全部通过（最多 5 轮，超过则换方案）
7. **更新 SCRATCHPAD.md**（重写，不是追加）
8. **Git commit**，commit message 格式: `feat|fix|refactor|test: 简要描述`
9. **继续下一个任务**

### ⚡ 行为规则

- **不要问我是否继续** — 直接继续
- **不要问我确认方案** — 用你的判断力，做完后告诉我做了什么
- **不要停在错误前面等我** — 自己调试、自己修复
- **不要一次只做一小步然后等反馈** — 一口气完成整个功能
- **不要输出大段解释再开始写代码** — 直接写代码
- **遇到设计选择** — 选更简单的方案，在 DECISIONS.md 记录理由
- **只有以下情况才来问我**:
  - 两种方案会导致完全不同的用户体验
  - 需要新的 API key 或外部服务配置
  - 架构级变更（影响 3+ 模块的接口改动）

### 🔧 故障恢复流程

**测试失败时:**
1. 读完整的 error traceback
2. 定位失败的具体代码行
3. 判断是新代码引起的还是已有代码的问题
4. 修复代码（不是修改测试来绕过）
5. 重新运行**全部测试**（不只是失败的那个）
6. 如果循环 3 次还没修好，换一个实现方案，在 DECISIONS.md 记录

**Lint / Type check 失败时:**
- 直接修复，不要问我
- 不要用 `# type: ignore` 或 `# noqa` 除非有写在 DECISIONS.md 里的技术原因

**依赖问题时:**
- 检查版本兼容性，尝试 pin 版本
- 如果需要替代依赖，在 DECISIONS.md 记录
- 不要降级核心依赖来解决兼容问题

**编译/构建失败时:**
- 读错误信息，不要猜
- 检查最近的改动是否引入了循环导入或类型冲突
- 修复后跑完整测试

### 🔍 自我检查（每完成 3 个任务执行一次）

1. 重新读一遍上面的 Mission，确认当前方向正确
2. 运行完整测试套件 + lint + type check
3. 重写 SCRATCHPAD.md
4. 扫描代码中是否有 TODO / FIXME / placeholder — 如果有，立即修复
5. 检查最近 3 次 commit 是否引入了不必要的复杂度
6. 每次做完比对要上传 github
