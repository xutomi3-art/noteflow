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

- **Phase 1** (current): Personal notebooks, PDF/DOCX/PPTX/TXT/MD upload, AI Q&A with citations, Studio (Summary/FAQ/Study Guide/Saved Notes). No Excel, no sharing.
- **Phase 2**: Excel support (DuckDB + dual-track RAG + query router), notebook sharing with Owner/Editor/Viewer roles
- **Phase 3+**: Mind Map, Podcast, PPT generation, mobile responsive
