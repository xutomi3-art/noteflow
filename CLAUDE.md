# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Noteflow is an AI-powered knowledge base tool inspired by NotebookLM. Users create notebooks, upload documents (PDF, DOCX, PPTX, TXT, MD), and interact through AI Q&A with citation traceability. Key differentiators: notebook-level sharing without team setup, Chinese LLM (Qwen), private deployment.

Full product spec: `PRD_KnowledgeBase_v4.md`

## Architecture

**Two-service architecture** behind an Nginx reverse proxy:

- **Frontend** (`frontend/`): React 19 + Vite 6 + Tailwind CSS + Zustand + TypeScript
- **Backend** (`backend/`): Python 3.12 FastAPI + SQLAlchemy 2.0 (async) + Pydantic 2
- **Nginx** routes `/api/*` → FastAPI:8000, `/*` → Vite:3000 — no CORS needed

Communication: REST + SSE (Server-Sent Events) for streaming. No WebSocket — SSE handles both chat streaming and document processing status.

**Important**: The backend uses `backend.` package prefix for all imports (e.g., `from backend.core.config import settings`). All backend commands (uvicorn, pytest, alembic) must run from the **project root**, not from `backend/`.

**Local dev modes:**
- **Full stack** (with RAGFlow): `docker compose up -d` → access via `localhost:3100`. The `docker-compose.override.yml` automatically adds RAGFlow + its dependencies (MySQL, Elasticsearch, Redis, MinIO) and maps ports 3100→Nginx, 8100→Backend, 9380→RAGFlow.
- **Frontend only**: `cd frontend && npm run dev` → Vite proxies `/api` to `localhost:8000` automatically (configured in `vite.config.ts`)

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
- `backend/services/chat_service.py` — AI response generation with citation assembly
- `backend/services/query_router.py` — Routes queries between standard RAG, Excel/DuckDB, and deep-thinking modes
- `backend/meeting/` — Self-contained meeting transcription module (ASR + speaker diarization) with its own models, schemas, router, and service

### External Services

Beyond Qwen (main LLM), the backend integrates several external APIs configured in `backend/core/config.py`:
- **Vision LLM**: GLM-4.5v (Zhipu, separate from Qwen) — `LLM_VISION_MODEL`, `LLM_VISION_API_KEY`
- **TTS**: Alibaba Cloud — podcast audio generation (`ALIBABA_TTS_APPKEY`)
- **ASR**: Volcengine — meeting transcription (`VOLCENGINE_ASR_APPID`)
- **Email**: Resend (`RESEND_API_KEY`) — primary; SMTP as legacy fallback
- **PPT**: Docmee API (`DOCMEE_API_KEY`) — alternative to python-pptx
- **Web Scraping**: Jina Reader — URL-to-document import

### RAG Tuning (backend/core/config.py)

Key retrieval knobs — change these to tune answer quality:
- `RAG_TOP_K=8` — chunks retrieved per query
- `RAG_VECTOR_WEIGHT=0.7` — vector vs BM25 balance (0.7 = 70% vector)
- `RAG_SIMILARITY_THRESHOLD=0.0` — minimum similarity cutoff
- `RAG_RERANK_ID="gte-rerank"` — reranking model
- `QUERY_REWRITE_ENABLED=False` — query rewriting (disabled by default)
- `RAPTOR_ENABLED=False` — tree-based retrieval (disabled by default)

### Backend Structure

- `backend/api/` — FastAPI routers (auth, chat, notebooks, sources, studio, sharing, admin, etc.)
- `backend/models/` — SQLAlchemy ORM models
- `backend/schemas/` — Pydantic request/response schemas
- `backend/services/` — Business logic layer (~30 services)
- `backend/core/` — Config (Pydantic BaseSettings), database engine, security, dependency injection
- `backend/tests/` — pytest tests (conftest uses in-memory SQLite with UUID/DateTime type adapters; `asyncio_mode = auto` in pytest.ini)

### State Management (Frontend)

Zustand stores in `frontend/src/stores/` with cross-panel coordination:
- `authStore` — JWT token, user profile, refresh logic
- `notebookStore` — notebook list, current notebook
- `sourceStore` — document sources per notebook
- `chatStore` — messages, streaming state, selected source IDs for scoped queries
- `studioStore` — generated outputs (summary, FAQ, study guide), saved notes
- `sharingStore` — notebook sharing, members, invite links
- `adminStore` — admin panel state
- `pendingUploadStore` — tracks in-progress file uploads

Path alias: `@/*` → `./src/*` (configured in tsconfig + vite). Each store has a co-located `.test.ts` file.

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
| Frontend | React 19, Vite 6, Tailwind CSS, Zustand, TypeScript |
| Backend | Python FastAPI, SQLAlchemy, Alembic, Pydantic |
| RAG Engine | RAGFlow (self-hosted, pinned Docker version) |
| Document Parsing | MinerU (CPU mode) |
| LLM (text) | Qwen-Plus / Qwen-Max via Alibaba Cloud API |
| LLM (vision) | GLM-4.5v via Zhipu API (separate from Qwen) |
| Embedding | text-embedding-v3 (Alibaba Cloud) |
| Database | PostgreSQL |
| Search | Elasticsearch (bundled with RAGFlow) |
| Reverse Proxy | Nginx |
| Containerization | Docker Compose |

## Development Commands

All backend commands run from the **project root** (not from `backend/`).

```bash
# Full stack (Docker Compose — includes RAGFlow via override)
docker compose up -d              # Start all services (Nginx:3100, Backend:8100, RAGFlow:9380)
docker compose down               # Stop all services
docker compose logs -f backend    # Tail backend logs

# Frontend (local dev)
cd frontend && npm install
npm run dev                       # Vite dev server on :3000 (proxies /api → :8000)
npm run build                     # tsc --noEmit + Vite production build
npm run lint                      # TypeScript type check only (tsc --noEmit)

# Backend (local dev — run from project root)
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000    # FastAPI dev server
alembic -c backend/alembic.ini upgrade head       # Run DB migrations
alembic -c backend/alembic.ini revision --autogenerate -m "msg"  # Create migration

# Database
docker compose exec postgres psql -U noteflow -d noteflow
```

## Testing Commands

```bash
# Frontend unit tests (Vitest + testing-library/react, jsdom)
cd frontend
npm run test                      # Run all tests
npm run test:watch                # Watch mode
npm run test:coverage             # Coverage report (v8 provider)
npx vitest run src/stores/auth-store.test.ts  # Single test file

# Backend unit tests (pytest + pytest-asyncio — run from project root)
pip install -r backend/requirements-test.txt  # Install test deps (aiosqlite etc.)
pytest                            # Run all tests (pytest.ini: testpaths=backend/tests, asyncio_mode=auto)
pytest backend/tests/test_auth_api.py  # Single test file
pytest -v                         # Verbose output

# E2E tests (Playwright — sequential, workers=1)
cd e2e
npx playwright test               # Run all E2E tests (default: https://noteflow.jotoai.com)
npx playwright test tests/01-auth.spec.ts  # Single spec
npx playwright test --headed      # Visual browser mode
E2E_BASE_URL=http://localhost:3100 npx playwright test  # Against local
```

### Backend Test Infrastructure

Tests use **in-memory SQLite** (no PostgreSQL needed). Key patterns in `backend/tests/conftest.py`:
- **Type adapters**: PostgreSQL types (UUID, JSONB, DateTime with TZ) are swapped for SQLite equivalents
- **bcrypt speedup**: Rounds set to 4 (vs default 12) — ~75x faster password hashing in tests
- **External service mocks**: `process_document` is mocked in 3 import sites (sources, auth, document_pipeline) to avoid RAGFlow/MinerU calls
- **Client fixture**: Uses `httpx.AsyncClient` with `ASGITransport` — no real HTTP server needed
- **Helper functions**: `register_user()` and `create_notebook()` for quick test setup

## Deployment

- **Server**: 10.200.0.112 (Ubuntu 24.04, 16 cores, 16GB RAM, no GPU)
- All services run via Docker Compose behind Nginx
- Production has a separate `landing` service (Next.js marketing site) built from `/opt/netflow_frontend`
- Backend Docker image requires: `ffmpeg`, `libreoffice-impress`, CJK fonts (`fonts-noto-cjk`)
- See `LOGIN.md` for server credentials

## Design Conventions

- **Frontend style**: Apple-inspired — clean, generous whitespace, rounded corners, subtle shadows, system font stack (SF Pro style)
- **API format**: `{ "data": ... }` for success, `{ "error": { "code": "...", "message": "..." } }` for errors
- **Real-time**: SSE only (no WebSocket) for both chat streaming and status updates

## Feature Status

**Phases 1–5 are complete.** Current features: notebooks, document upload (PDF/DOCX/PPTX/TXT/MD/Excel/CSV), AI Q&A with citations, Studio (Summary/FAQ/Study Guide/Notes), Mind Map, Podcast, PPT generation, sharing (Owner/Editor/Viewer + invite links), Admin Panel, Google & Microsoft SSO, conversation memory, DeepSeek R1 thinking mode, demo onboarding, mobile responsive.

**Phase 6** (planned): Tenant-based sharing, Presenton GPU PPT, Vanna.ai, Chart Understanding, Subscription plans, Private deployment, Open API

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

### 🐛 Bug → 测试用例闭环

每次用户测试发现 bug 并修复后，**必须**执行以下步骤：

1. 将该 bug 对应的测试用例添加到 `noteflow-e2e-test` skill 的 `references/test-cases.md` 中
2. 用 skill-creator verify 验证 skill 格式正确
3. 运行新增的测试用例确认 PASS

目的：确保同一个 bug 永远不会再次出现。每次做回归测试时，所有历史 bug 都会被覆盖到。

### 🔍 自我检查（每完成 3 个任务执行一次）

1. 重新读一遍上面的 Mission，确认当前方向正确
2. 运行完整测试套件 + lint + type check
3. 重写 SCRATCHPAD.md
4. 扫描代码中是否有 TODO / FIXME / placeholder — 如果有，立即修复
5. 检查最近 3 次 commit 是否引入了不必要的复杂度
6. 每次做完比对要上传 github
