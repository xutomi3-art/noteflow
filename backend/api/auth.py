import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from sqlalchemy import select

from backend.core.config import settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.core.security import create_access_token, create_refresh_token, create_password_reset_token, decode_password_reset_token, hash_password
from backend.models.user import User
from backend.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest, UserResponse, ForgotPasswordRequest, ResetPasswordRequest
from backend.services import auth_service
from backend.services import google_auth_service
from backend.services import microsoft_auth_service
from backend.services.email_service import is_smtp_configured, send_password_reset_email
from backend.services.notebook_service import create_notebook
from backend.services.note_service import create_note
from backend.schemas.notebook import NotebookCreate

router = APIRouter(prefix="/auth", tags=["auth"])


_DEFAULT_NOTES: dict[str, list[str]] = {
    "Getting Started": [
        "**Welcome to Noteflow!** 🎉\n\nNoteflow is your AI-powered knowledge base. Upload documents (PDF, DOCX, PPTX, TXT, Excel) and ask questions — AI will answer with citations pointing to the exact source.",
        "**Quick Start Guide:**\n\n1. Click **Add Sources** on the left to upload documents\n2. Select sources to chat with using the checkboxes\n3. Ask questions in the **Chat** panel — AI responds with inline citations [1][2]\n4. Use **Studio** on the right to generate Summaries, FAQs, Mind Maps, and Slide Decks\n5. Save important answers as **Notes** for quick reference",
        "**Tips & Tricks:**\n\n- Upload multiple file types together (PDF + Excel + TXT) for cross-document Q&A\n- Click on citation numbers [1] to jump to the source excerpt\n- Use **Share with Team** to collaborate with others on the same notebook\n- Try the **Think** button for deeper, step-by-step reasoning on complex questions",
    ],
    "Meeting Notes": [
        "## 📊 Q3 产品规划会议纪要\n\n**日期：** 2026-03-10  |  **参会人：** 张总、李工、王PM、陈设计\n\n### 核心决策\n1. **AI 问答引擎升级** — 从 Qwen-Plus 切换到 DeepSeek-R1，支持深度推理模式 [1]\n2. **文档解析增强** — 新增 Excel/CSV 表格数据分析能力，集成 DuckDB [2]\n3. **协作功能** — 支持 Notebook 级别分享（Owner/Editor/Viewer 三种角色）\n\n### 行动项\n| 负责人 | 任务 | 截止日期 |\n|--------|------|----------|\n| 李工 | DeepSeek API 集成 | 3/20 |\n| 王PM | 分享功能 PRD | 3/15 |\n| 陈设计 | 新版 UI 原型 | 3/18 |\n\n> 💡 **AI 生成摘要：** 本次会议确定了 Q3 三大技术方向，重点在 AI 推理能力提升和协作功能。预计 4 月底完成 Phase 2 全部功能。",
        "## 🤝 客户需求评审 — 某金融集团\n\n**日期：** 2026-03-14  |  **客户：** XX证券研究所\n\n### 客户痛点\n- 每天需要阅读 50+ 份研报（PDF），人工摘要耗时 3 小时\n- 跨文档信息关联困难，无法快速定位关键数据\n- 现有工具不支持中文金融术语的精准检索\n\n### Noteflow 方案\n1. **批量上传研报** → MinerU 解析 PDF 保留表格和图表引用\n2. **智能问答** → \"今年 Q1 哪些行业的 PE 估值低于历史均值？\" → AI 从多份研报交叉引用回答，附带 [页码] 溯源\n3. **Studio 一键生成** → 投资周报摘要、FAQ 文档、思维导图\n\n### 下一步\n- 安排 POC 演示（3/20）\n- 准备 10 份样例研报用于测试",
        "## 🚀 Sprint Review — Week 11\n\n**日期：** 2026-03-15  |  **团队：** 后端 x2, 前端 x1, 设计 x1\n\n### 本周完成\n- ✅ Mind Map 生成功能（Markmap 渲染）\n- ✅ Podcast 音频生成（TTS 双人对话模式）\n- ✅ PPT 一键生成（python-pptx + Presenton 模板）\n- ✅ 移动端响应式布局适配\n\n### 演示亮点\n上传一份 30 页的技术白皮书 → 5 秒完成解析 → AI 自动生成：\n- 📝 3 段式摘要（含引用标记）\n- ❓ 10 个 FAQ（每个附带原文出处）\n- 🧠 思维导图（可展开/折叠的知识结构）\n- 🎙️ 8 分钟播客（两人对话风格讲解）\n- 📊 15 页 PPT（专业排版，一键下载）\n\n> 反馈：\"这个 Studio 功能太强了，一份文档变 5 种输出格式\" — 王总",
    ],
    "My Research": [
        "## 🔍 RAG 技术架构调研笔记\n\n### 检索增强生成（RAG）核心流程\n\n```\n文档上传 → 解析(MinerU) → 分块(Chunking) → 向量化(Embedding)\n                                                    ↓\n用户提问 → 混合检索(70%向量 + 30%BM25) → Top-K 召回 → LLM 生成答案\n                                                    ↓\n                                              引用溯源 [1][2][3]\n```\n\n### 关键技术选型对比\n\n| 维度 | RAGFlow | LangChain | LlamaIndex |\n|------|---------|-----------|------------|\n| 中文支持 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |\n| 文档解析 | 内置 DeepDoc | 需集成 | 需集成 |\n| 检索质量 | 混合检索 | 可配置 | 可配置 |\n| 部署复杂度 | Docker 一键 | 代码集成 | 代码集成 |\n| 引用追踪 | 原生支持 | 需自建 | 需自建 |\n\n### 结论\n选择 **RAGFlow** 作为检索引擎，但 LLM 生成部分由 FastAPI 自行控制，以实现：\n- 自定义 Prompt 模板\n- 流式输出（SSE）\n- 精确的引用格式控制",
        "## 📈 大模型性能评测报告\n\n### 测试场景：中文文档问答（500 个 QA 对）\n\n| 模型 | 准确率 | 引用正确率 | 平均延迟 | 成本/1K tokens |\n|------|--------|------------|----------|---------------|\n| GPT-4o | 92.3% | 88.1% | 2.1s | ¥0.15 |\n| DeepSeek-V3 | 91.8% | 90.2% | 1.4s | ¥0.01 |\n| Qwen-Plus | 89.5% | 87.6% | 1.8s | ¥0.04 |\n| DeepSeek-R1 | 94.1% | 93.5% | 4.2s | ¥0.04 |\n\n### 关键发现\n1. **DeepSeek-R1** 在需要推理的复杂问题上表现最佳（+2.3% vs GPT-4o）\n2. **DeepSeek-V3** 性价比最高 — 准确率接近 GPT-4o，成本仅 1/15\n3. 引用正确率与 chunk 大小强相关 — 512 tokens 最优\n\n### 最终方案\n- 日常问答：DeepSeek-V3（快速、便宜）\n- 深度推理：DeepSeek-R1（Think 模式，展示推理过程）\n- Embedding：Qwen text-embedding-v3（中文最优）",
        "## 🏗️ 竞品分析：NotebookLM vs Noteflow\n\n### Google NotebookLM\n**优势：**\n- Google 品牌背书，Gemini 模型能力强\n- Audio Overview（播客生成）体验流畅\n- 免费使用\n\n**劣势：**\n- 🚫 中国大陆无法使用\n- 🚫 不支持中文优化\n- 🚫 无法私有化部署\n- 🚫 数据存储在 Google 服务器\n\n### Noteflow 差异化\n| 能力 | NotebookLM | Noteflow |\n|------|------------|----------|\n| 中文支持 | 一般 | ⭐ 原生优化 |\n| 私有部署 | ❌ | ✅ Docker 一键部署 |\n| 数据安全 | Google 托管 | 自主可控 |\n| 协作分享 | ❌ | ✅ 三种角色权限 |\n| Excel 分析 | ❌ | ✅ DuckDB SQL |\n| PPT 生成 | ❌ | ✅ 专业模板 |\n| 思维导图 | ❌ | ✅ 可交互 |\n| 多 LLM | Gemini only | ✅ 可切换 |\n| SSO 登录 | Google only | ✅ Google + Microsoft |\n\n> **核心定位：** 面向中国企业的 NotebookLM 替代品 — 私有部署、数据安全、中文优化",
    ],
}


async def _create_default_notebooks(db: AsyncSession, user: User) -> None:
    """Create default starter notebooks with demo content for a new user."""
    default_notebooks = [
        {"name": "Meeting Notes", "emoji": "📋", "cover_color": "#fef08a"},
        {"name": "My Research", "emoji": "🔬", "cover_color": "#dbeafe"},
        {"name": "Getting Started", "emoji": "🚀", "cover_color": "#ecfccb"},
    ]
    for nb_data in default_notebooks:
        try:
            nb = await create_notebook(
                db,
                owner_id=user.id,
                req=NotebookCreate(**nb_data),
            )
            for note_content in _DEFAULT_NOTES.get(nb_data["name"], []):
                try:
                    await create_note(db, nb.id, note_content, user_id=user.id)
                except Exception:
                    pass
        except Exception:
            logger.warning("Failed to create default notebook '%s' for user %s", nb_data["name"], user.id)


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await auth_service.register(db, req)
        await _create_default_notebooks(db, user)
        return await auth_service.login(db, LoginRequest(email=req.email, password=req.password))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await auth_service.login(db, req)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await auth_service.refresh_tokens(db, req.refresh_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        avatar=user.avatar,
        is_admin=user.is_admin,
        auth_provider=user.auth_provider,
    )


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Send a password reset email. Always returns 200 to avoid user enumeration."""
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user and user.password_hash and is_smtp_configured():
        token = create_password_reset_token(str(user.id), user.password_hash)
        reset_url = f"{settings.APP_BASE_URL}/reset-password?token={token}"
        try:
            await send_password_reset_email(user.email, reset_url)
        except Exception:
            logger.exception("Failed to send password reset email to %s", user.email)
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Validate the reset token and update the user's password."""
    # We need to find the user without knowing their ID yet — decode the token's sub claim
    # by first doing a lightweight decode (no signature check) just to extract user_id,
    # then loading the user and re-verifying with the correct secret.
    from jose import jwt as _jwt
    try:
        unverified = _jwt.get_unverified_claims(req.token)
        user_id = unverified.get("sub")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    verified_id = decode_password_reset_token(req.token, user.password_hash)
    if not verified_id or verified_id != str(user.id):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.password_hash = hash_password(req.new_password)
    await db.commit()
    return {"message": "Password updated successfully."}


@router.get("/google")
async def google_login(db: AsyncSession = Depends(get_db)):
    """Redirect to Google OAuth consent screen."""
    client_id, _secret, redirect_uri = await google_auth_service.get_google_config(db)
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured")
    url = google_auth_service.build_google_auth_url(client_id, redirect_uri)
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_callback(code: str = "", error: str = "", db: AsyncSession = Depends(get_db)):
    """Handle Google OAuth callback, exchange code, issue JWT, redirect to frontend."""
    if error or not code:
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_denied")

    try:
        client_id, client_secret, redirect_uri = await google_auth_service.get_google_config(db)
        tokens = await google_auth_service.exchange_code_for_tokens(code, client_id, client_secret, redirect_uri)
        user_info = await google_auth_service.get_google_user_info(tokens["access_token"])

        google_id = user_info.get("id") or user_info.get("sub")
        email = user_info.get("email")
        name = user_info.get("name") or email
        avatar = user_info.get("picture")

        if not google_id or not email:
            return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_missing_info")

        user, is_new = await auth_service.find_or_create_google_user(db, google_id, email, name, avatar)
        if is_new:
            await _create_default_notebooks(db, user)

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))

        return RedirectResponse(
            url=f"{settings.APP_BASE_URL}/auth/callback?token={access_token}&refresh={refresh_token}"
        )
    except Exception:
        logger.exception("Google OAuth callback failed")
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_failed")


@router.get("/microsoft")
async def microsoft_login(db: AsyncSession = Depends(get_db)):
    """Redirect to Microsoft OAuth consent screen."""
    client_id, _secret, tenant_id, redirect_uri = await microsoft_auth_service.get_microsoft_config(db)
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=503, detail="Microsoft OAuth is not configured")
    url = microsoft_auth_service.build_microsoft_auth_url(client_id, tenant_id, redirect_uri)
    return RedirectResponse(url=url)


@router.get("/microsoft/callback")
async def microsoft_callback(code: str = "", error: str = "", db: AsyncSession = Depends(get_db)):
    """Handle Microsoft OAuth callback, exchange code, issue JWT, redirect to frontend."""
    if error or not code:
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_denied")

    try:
        client_id, client_secret, tenant_id, redirect_uri = await microsoft_auth_service.get_microsoft_config(db)
        tokens = await microsoft_auth_service.exchange_code_for_tokens(code, client_id, client_secret, tenant_id, redirect_uri)
        user_info = await microsoft_auth_service.get_microsoft_user_info(tokens["access_token"])

        microsoft_id = user_info.get("id")
        email = user_info.get("mail") or user_info.get("userPrincipalName")
        name = user_info.get("displayName") or email
        avatar = None  # Microsoft Graph /me doesn't return avatar URL

        if not microsoft_id or not email:
            return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_missing_info")

        user, is_new = await auth_service.find_or_create_microsoft_user(db, microsoft_id, email, name, avatar)
        if is_new:
            await _create_default_notebooks(db, user)

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))

        return RedirectResponse(
            url=f"{settings.APP_BASE_URL}/auth/callback?token={access_token}&refresh={refresh_token}"
        )
    except Exception:
        logger.exception("Microsoft OAuth callback failed")
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_failed")
