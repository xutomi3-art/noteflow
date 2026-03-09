# Noteflow 实施计划

## Context

Noteflow 是一个类 NotebookLM 的 AI 知识库产品，核心差异化：笔记本级共享（无需团队设置）、Excel 语义理解、中文 LLM（Qwen）、私有部署。

本计划覆盖全部 4 个 Phase，从 MVP 到商业化。

### 关键决定

- Excel 支持 → Phase 2
- 共享功能 → Phase 2
- Studio 高级功能（Mind Map / Podcast / PPT 生成）→ Phase 3
- 共享笔记本中聊天记录各用户独立
- 部署目标：10.200.0.112（16核/16GB/175GB/Ubuntu 24.04/无GPU）
- Phase 1 用本地存储（Docker volume），不引入 OSS
- RAGFlow 独立 docker-compose 部署（自带 ES+Redis+MySQL），通过 Docker network 连接

### 已完成

- ✅ 用户注册/登录（JWT）— 后端 API + 前端页面 + token 管理 + 路由守卫
- ✅ 笔记本 CRUD + Home Page — 后端 API + 前端 Dashboard + 卡片 + 创建弹窗
- ✅ Docker 配置（Nginx + Frontend + Backend + PostgreSQL）
- ✅ 数据模型定义（User, Notebook, Source, ChatMessage, SavedNote）
- ✅ Pydantic schemas（auth, notebook, source, chat, note）
- ✅ 三栏布局壳（Sources / Chat / Studio 面板占位）

---

## 技术架构

### 技术栈

| 层 | 选型 |
|---|---|
| Frontend | Next.js 15 + Tailwind CSS + Zustand |
| Backend | Python FastAPI |
| RAG | RAGFlow（自托管，固定版本） |
| Doc Parsing | MinerU（CPU 模式） |
| LLM | Qwen-Plus（阿里云 API） |
| Embedding | text-embedding-v3（阿里云 API） |
| DB | PostgreSQL |
| Storage | 本地存储（Docker volume） |
| Reverse Proxy | Nginx |
| 容器化 | Docker Compose |

### 架构决策

- Nginx 反向代理从第一天开始 — `/api/*` → FastAPI，`/*` → Next.js，消除 CORS
- SSE 统一 — 聊天流式和文档处理状态都用 SSE，不引入 WebSocket
- RAGFlow 仅做检索 — 不用 RAGFlow 的 LLM 生成功能，自己调 Qwen API 生成答案
- RAGFlow 独立 docker-compose — 自带 ES+Redis+MySQL，不混入主 compose
- 自定义 JWT 认证 — FastAPI 签发，不用 NextAuth
- Zustand 状态管理 — 轻量、TypeScript 友好

### 目录结构

```
Noteflow/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── login/              ✅ 已完成
│   │   │   ├── register/           ✅ 已完成
│   │   │   ├── dashboard/          ✅ 已完成
│   │   │   └── notebook/[id]/      ✅ 壳已完成，内容待实现
│   │   ├── components/
│   │   │   ├── ui/                 ✅ Button, Modal, Input
│   │   │   ├── notebook/           ✅ NotebookCard, CreateNotebookModal
│   │   │   ├── sources/            ← Step 3 新建
│   │   │   ├── chat/               ← Step 4 新建
│   │   │   └── studio/             ← Step 6 新建
│   │   ├── services/api.ts         ✅ 部分完成，待扩展
│   │   ├── stores/                 ✅ auth-store, notebook-store
│   │   └── types/api.ts            ✅ 已定义所有接口（含 Citation）
│   └── package.json
├── backend/
│   ├── __init__.py                 ← Step 1 创建（Docker 部署必需）
│   ├── api/
│   │   ├── auth.py                 ✅ 已完成
│   │   ├── notebooks.py            ✅ 已完成
│   │   ├── sources.py              placeholder → Step 3
│   │   ├── chat.py                 placeholder → Step 4
│   │   ├── studio.py               ← Step 6 新建
│   │   └── notes.py                ← Step 4 新建
│   ├── services/
│   │   ├── auth_service.py         ✅ 已完成
│   │   ├── notebook_service.py     ✅ 已完成
│   │   ├── source_service.py       ← Step 3 新建
│   │   ├── chat_service.py         ← Step 4 新建
│   │   ├── ragflow_client.py       ← Step 3 新建
│   │   ├── mineru_client.py        ← Step 3 新建
│   │   ├── qwen_client.py          ← Step 4 新建
│   │   ├── document_pipeline.py    ← Step 3 新建
│   │   ├── event_bus.py            ← Step 3 新建（SSE 事件总线）
│   │   ├── studio_service.py       ← Step 6 新建
│   │   └── note_service.py         ← Step 4 新建
│   ├── models/                     ✅ 已完成
│   ├── schemas/                    ✅ 已完成
│   ├── core/                       ✅ 已完成
│   └── utils/
├── docker/
│   ├── nginx/nginx.conf            ✅ 已完成
│   ├── Dockerfile.frontend         ✅ 已完成
│   └── Dockerfile.backend          ✅ 已完成
├── docker-compose.yml              ✅ 已完成
└── .env.example                    ✅ 已完成
```

### 数据模型

```sql
-- User ✅ 已实现
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Notebook ✅ 已实现（需加 ragflow_dataset_id）
CREATE TABLE notebooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    emoji VARCHAR(10) DEFAULT '📒',
    cover_color VARCHAR(20) DEFAULT '#4A90D9',
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    is_shared BOOLEAN DEFAULT FALSE,
    ragflow_dataset_id VARCHAR(100),  -- 每个 notebook 对应一个 RAGFlow dataset（懒创建）
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Source ✅ 已实现
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id),
    filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(20) NOT NULL,
    file_size BIGINT,
    storage_url VARCHAR(1000),
    status VARCHAR(20) DEFAULT 'uploading',
    ragflow_doc_id VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ChatMessage ✅ 已实现
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    role VARCHAR(20) NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- SavedNote ✅ 已实现
CREATE TABLE saved_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,
    source_message_id UUID REFERENCES chat_messages(id),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 引用元数据契约

```typescript
// frontend/src/types/api.ts（已定义）
interface Citation {
  index: number;          // [1], [2], ...
  source_id: string;      // Source UUID
  filename: string;       // 原始文件名
  file_type: string;      // 'pdf' | 'docx' | 'pptx' | 'txt' | 'md'
  location: {
    page?: number;        // PDF/DOCX 页码
    slide?: number;       // PPTX 幻灯片号
    paragraph?: number;   // 段落序号
  };
  excerpt: string;        // 原文摘录
}
```

---

## Phase 1 · 文档知识库 MVP

> Phase 1 范围：个人笔记本 + AI Q&A 端到端。不含 Excel、不含共享。
> Home Page 只显示 "Personal Notebooks" 区域（Phase 2 加 "Shared Notebooks"）。

### Step 1: 基础设施 (3 天)

- 服务器安装 Docker + Docker Compose
- 创建 `backend/__init__.py`（空文件，Docker uvicorn 导入必需）
- RAGFlow 独立部署（单独 docker-compose，含 ES+Redis+MySQL）
  - 创建 API key，记录到 `.env` 和 `LOGIN.md`
  - 通过 Docker network 或 host IP 使 backend 可达 RAGFlow
- MinerU 部署（Docker，CPU 模式，port 8010）+ 连通性验证
- 部署当前应用（`docker compose up -d --build`）
- PostgreSQL 初始化 + Alembic 迁移（加 `ragflow_dataset_id` 列）
- `.env` 生产环境配置

**验证**:
- `curl /api/health` → ok
- RAGFlow API 可达：`curl http://<ragflow>:9380/api/v1/datasets`
- MinerU 可解析测试 PDF
- 浏览器注册 → 登录 → 创建笔记本 → Dashboard 显示

### ~~Step 2: 认证系统~~ ✅ 已完成

### ~~Step 2.5: 笔记本 CRUD + Home Page~~ ✅ 已完成

### Step 3: 文档上传 + 处理管线 (5 天)

**后端**:
- `source_service.py`：Source 模型 CRUD
- `mineru_client.py`：PDF/DOCX/PPTX → MinerU REST API → Markdown（含 `<!-- page:N -->` 标记）
- `ragflow_client.py`：dataset CRUD、文档上传、触发 parsing、轮询状态、检索
- `document_pipeline.py`：编排全流程（FastAPI BackgroundTask）
  - uploading → parsing（MinerU）→ vectorizing（RAGFlow）→ ready
  - 每步更新 Source status，通过 event_bus 推送 SSE 事件
- `event_bus.py`：asyncio Queue 实现的 SSE 事件总线（per notebook_id）
- python-pptx：PPT 文本 + speaker notes 提取（每张幻灯片 = 一个 chunk）
- TXT/MD：直接读取
- API 端点（`sources.py`）：
  - `POST /api/notebooks/{id}/sources` — 多文件上传
  - `GET /api/notebooks/{id}/sources` — 列表 + 状态
  - `DELETE /api/notebooks/{id}/sources/{sid}` — 删除（含 RAGFlow 清理）
  - `GET /api/notebooks/{id}/sources/status` — SSE 实时状态流

**前端**:
- `source-store.ts`：sources 列表、selectedIds、upload、SSE 连接
- `SourcesPanel.tsx`：文件列表 + 状态徽标 + 勾选框 + "Select all"
- `SourceItem.tsx`：单个 source 行（⏳→🔄→⚡→✅/❌）
- `UploadDropZone.tsx`：拖拽上传 + 多文件批量上传（accept: .pdf,.docx,.pptx,.txt,.md）
- Chat 输入框：无 ready source 时禁用，提示"等待文档处理完成"

**验证**: 上传 PDF → 状态 uploading→parsing→vectorizing→ready → RAGFlow 中有索引

### Step 4: AI 问答 + 引用溯源 (5 天)

**后端**:
- `qwen_client.py`：Qwen API 封装（OpenAI 兼容端点 `dashscope.aliyuncs.com/compatible-mode/v1`）
  - `stream_chat(messages)` — SSE 流式生成
  - `generate_chat(messages)` — 非流式（概览/Studio 用）
- `chat_service.py`：
  - 保存用户消息 → RAGFlow 检索（70% vector + 30% BM25，可按 source_ids 过滤）→ 构建 prompt（含 chunk 位置元数据）→ Qwen-Plus SSE 生成 → 解析 `[1][2]` 引用 → 保存助手消息 + citations JSON
  - `get_chat_history(notebook_id, user_id)`
  - `clear_chat_history(notebook_id, user_id)`
- `note_service.py`：SavedNote CRUD
- API 端点：
  - `POST /api/notebooks/{id}/chat` — SSE streaming response
  - `GET /api/notebooks/{id}/chat/history`
  - `DELETE /api/notebooks/{id}/chat/history`
  - `POST /api/notebooks/{id}/notes` / `GET` / `DELETE`

**前端**:
- `chat-store.ts`：消息列表、流式状态、概览、推荐问题
- `ChatPanel.tsx`：对话流 + 流式渲染 + 概览 + 推荐问题
- `ChatMessage.tsx`：用户/AI 气泡、Markdown 渲染、[Save to note] / 📋 / 👍👎
- `CitationList.tsx`：引用展开/收起（`[1] filename.pdf · p.3` + 原文摘录）
- `ChatInput.tsx`：输入框 + source 数量标签 + 发送按钮
- 依赖：`react-markdown`, `remark-gfm`
- SSE 实现：用 `fetch()` + ReadableStream（POST 不能用 EventSource）

**验证**: 提问 → SSE 流式输出 → 引用标记正确 → 勾选 source 过滤生效

### Step 5: 自动概览 + 推荐问题 (2 天)

**后端**:
- 所有 source ready 后触发 Qwen 生成笔记本概览
- 生成 3 个上下文相关的推荐问题
- 缓存结果，source 变更时标记过期重新生成

**前端**:
- 初始状态渲染（概览 + 推荐问题卡片，点击即提问）

### Step 6: Studio 面板 (3 天)

**后端**:
- `studio_service.py`：Summary / FAQ / Study Guide 生成（各一个 Qwen prompt）
- `studio.py` 端点：
  - `POST /api/notebooks/{id}/studio/summary` — SSE stream
  - `POST /api/notebooks/{id}/studio/faq` — SSE stream
  - `POST /api/notebooks/{id}/studio/study-guide` — SSE stream

**前端**:
- `studio-store.ts`：activeTab、生成内容、流式状态、notes
- `StudioPanel.tsx`：卡片 UI（Summary / FAQ / Study Guide / Saved Notes）
- `StudioContentView.tsx`：Markdown 渲染 + [Regenerate]
- `SavedNotesList.tsx`：笔记列表 + 删除

### Step 7: 集成测试 + 修复 (3 天)

- 端到端流程测试（注册 → 创建笔记本 → 上传文档 → AI 问答 → 引用检查）
- 性能调优（SSE 延迟、RAGFlow 检索速度）
- 错误处理完善
- UI 打磨（Apple 风格）
- 部署到 10.200.0.112 并验证

**Phase 1 总计：~21 个工作日（认证+CRUD 已完成省 5 天）**

---

## Phase 2 · 笔记本共享 (4 周)

### Step 8: 后端 — 共享 + 权限 (5 天)

**新建数据模型**:

```sql
CREATE TABLE notebook_members (
    notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,  -- 'owner' | 'editor' | 'viewer'
    joined_at TIMESTAMP DEFAULT NOW(),
    last_active_at TIMESTAMP,
    PRIMARY KEY (notebook_id, user_id)
);

CREATE TABLE invite_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,
    token VARCHAR(100) UNIQUE NOT NULL,
    role VARCHAR(20) DEFAULT 'viewer',
    expires_at TIMESTAMP,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);
```

**新建后端文件**:
- `backend/models/notebook_member.py`
- `backend/models/invite_link.py`
- `backend/services/sharing_service.py` — invite link 生成/加入、邮件邀请、成员管理、转让/停止共享
- `backend/services/permission_service.py` — PRD §6.1 角色权限检查
- `backend/api/sharing.py`：
  - `POST /api/notebooks/{id}/share` — 生成邀请链接 / 发邮件邀请
  - `DELETE /api/notebooks/{id}/share` — 停止共享
  - `GET /api/notebooks/{id}/members` — 成员列表
  - `PATCH /api/notebooks/{id}/members/{uid}` — 修改角色
  - `DELETE /api/notebooks/{id}/members/{uid}` — 移除成员
  - `POST /api/notebooks/{id}/leave` — 离开笔记本
  - `PATCH /api/notebooks/{id}/owner` — 转让 ownership
  - `POST /api/join/{token}` — 通过邀请链接加入

**修改现有端点**: notebooks/sources/chat 加权限检查

**权限矩阵**（PRD §6.1）:

| 操作 | Owner | Editor | Viewer |
|------|:-----:|:------:|:------:|
| 查看笔记本 + AI 提问 | ✅ | ✅ | ✅ |
| 上传/删除文档 | ✅ | ✅ | ❌ |
| 重命名笔记本 | ✅ | ✅ | ❌ |
| 分享/邀请 | ✅ | ✅ | ❌ |
| 删除笔记本 | ✅ | ❌ | ❌ |
| 管理角色 / 移除成员 | ✅ | ❌ | ❌ |
| 转让 ownership | ✅ | ❌ | ❌ |

### Step 9: 前端 — 分享 UI + 成员管理 (5 天)

**新建**:
- `frontend/src/components/sharing/ShareModal.tsx` — 邀请链接（复制/过期/撤销）+ 邮件邀请
- `frontend/src/components/sharing/MemberList.tsx` — 成员行：头像、角色、🟢/⚪ 状态
- `frontend/src/components/sharing/MemberManagementModal.tsx` — Owner 专用
- `frontend/src/stores/sharing-store.ts`
- `frontend/src/app/join/[token]/page.tsx` — 邀请加入页面

**修改**:
- Dashboard 拆分 "Personal Notebooks" / "Shared Notebooks" 两个区域
- NotebookCard 显示 `👤 N` 成员数徽标（仅共享笔记本）
- Notebook 页 header 加 [Share] 按钮
- Studio 面板底部显示 Members 区域（仅共享笔记本）

**状态流转**（PRD §6.2）: Personal → 添加首个成员 → Shared → 移除所有成员 → Personal

### Step 10: 集成 + 部署 (3 天)

- 聊天历史各用户独立验证
- 权限端到端测试
- Alembic 迁移 + 部署

---

## Phase 3 · 体验增强 (4 周)

### Step 11: Excel 双轨管线 (5 天)

**新建后端文件**:
- `backend/services/excel_processor.py` — openpyxl：展开合并单元格、识别表头、拆分 Sheet、生成双轨 chunks
- `backend/services/excel_router.py` — Qwen-Turbo 分类器（~80 行）：数值问题→SQL，文本问题→RAG
- `backend/services/duckdb_service.py` — 注册 Excel 为 DuckDB 表、执行 SQL、schema 上下文

**修改**:
- `document_pipeline.py` — 加 Excel 分支（openpyxl 处理，不走 MinerU）
- `chat_service.py` — 加 router：有 Excel source 时分流
- `requirements.txt` — 加 `openpyxl`, `xlrd`, `duckdb`, `pandas`

**关键设计**:
- 跨文件查询：一个 notebook 的所有 Excel 注册为同一 DuckDB session 的命名表
- SQL 失败 → 重试 3 次 → 降级 RAG → 提示用户

### Step 12: Inline PDF Viewer (3 天)

- `frontend/src/components/viewer/PdfViewer.tsx` — PDF.js 渲染 + 翻页
- `frontend/src/components/viewer/DocumentPreview.tsx` — 文件类型分发
- 点击 source → 内联预览，点击引用 → 跳转到对应页面

### Step 13: Mind Map 生成 (3 天)

- `studio_service.py` → `generate_mind_map()`: Qwen → JSON 节点/边
- `frontend/src/components/studio/MindMapView.tsx` — 交互式思维导图（reactflow / d3）

### Step 14: Podcast 生成 (3 天)

- `backend/services/tts_service.py` — 阿里云 TTS（双人声）
- `studio_service.py` → `generate_podcast()`: Qwen 编写双人对话 → TTS → MP3（~5-10分钟）
- `frontend/src/components/studio/PodcastPlayer.tsx` — 内联音频播放器

### Step 15: PPT 生成 (2 天)

- `studio_service.py` → `generate_ppt()`: Qwen 结构化大纲 → python-pptx → .pptx
- 前端 Studio 卡片，点击下载

### Step 16: Excel 表格预览 (2 天)

- `frontend/src/components/viewer/ExcelPreview.tsx` — HTML 表格 + Sheet 切换
- 后端端点返回解析后的 JSON

### Step 17: 移动端适配 (3 天)

- 可折叠三栏布局，移动端 bottom sheet
- Dashboard 2 列网格
- 触摸友好尺寸 + 响应式断点

### Step 18: 部署 Phase 3

---

## Phase 4 · 商业化（未来）

### Step 19: 订阅计划

| | Free | Pro | Business |
|---|---|---|---|
| 笔记本数 | 5 | 无限 | 无限 |
| 每本 Source 数 | 10 | 50 | 200 |
| AI 查询/天 | 20 | 200 | 无限 |
| 每本成员数 | 0 | 10 | 无限 |

- `backend/models/subscription.py` — 订阅模型
- `backend/services/billing_service.py` — 计划执行 + 限额检查
- `frontend/src/app/settings/billing/page.tsx`

### Step 20: Usage Dashboard

- `backend/services/analytics_service.py` — 存储、查询、成员统计
- `frontend/src/app/settings/usage/page.tsx` — 图表展示

### Step 21: SSO 集成 (SAML / OIDC)

- `backend/services/sso_service.py`
- 登录页 SSO 按钮

### Step 22: Open API

- `backend/api/open_api.py` — API Key 认证的外部接口
- `frontend/src/app/settings/api/page.tsx` — Key 管理

---

## 验证计划

### 端到端测试流程

1. 注册新用户 → 登录
2. 创建笔记本 → 输入名称/emoji/颜色
3. 上传 2-3 个 PDF 文件 → 观察状态 uploading → parsing → vectorizing → ready
4. 等所有文档 ready → 检查自动概览和推荐问题
5. 提问 → 检查 SSE 流式输出 + 引用标记
6. 点击引用 → 检查文件名 + 页码 + 原文摘录
7. 勾选/取消 source → 提同一个问题 → 验证范围过滤
8. Save to note → 检查 Studio 面板
9. 生成 Summary / FAQ / Study Guide → 检查输出
10. Clear chat → 确认清空

### 关键指标

- AI first token < 5s（无 GPU 放宽）
- PDF 解析 < 120s（CPU 模式，20MB 文件）
- 引用准确率 > 90%（手动抽检 20 个问答）
- 页面首屏 < 3s

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 16GB 内存紧张（RAGFlow+ES 吃 8GB+） | 系统 OOM | 限制 ES heap 4GB，监控内存，必要时升级 |
| RAGFlow API 版本不稳定 | 接口不兼容 | 固定 Docker 镜像版本，写集成测试 |
| MinerU CPU 模式解析慢 | 用户体验差 | 放宽 NFR 到 120s，异步处理 + SSE 状态推送 |
| Qwen API 限流 | 高并发时失败 | 加请求队列 + 重试，Phase 1 用户量小 |
