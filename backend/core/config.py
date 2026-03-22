import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://noteflow:noteflow_secret@localhost:5432/noteflow"

    # JWT
    JWT_SECRET_KEY: str = "change-me-to-a-random-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # LLM API (OpenAI-compatible endpoint)
    LLM_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    LLM_MODEL: str = "qwen3.5-plus"
    LLM_MAX_OUTPUT_TOKENS: int = 16384
    LLM_CONTEXT_WINDOW: int = 1000000  # qwen3.5-plus supports 1M context
    RAG_TOP_K: int = 8
    RAG_SIMILARITY_THRESHOLD: float = 0.0
    RAG_VECTOR_WEIGHT: float = 0.7
    RAG_REWRITE_MODEL: str = ""  # empty = use main LLM_MODEL
    RAG_DECOMPOSE_MODEL: str = ""  # empty = use main LLM_MODEL
    RAG_RERANK_ID: str = "gte-rerank"
    RAG_THINK_ROUNDS: int = 5  # max ReAct rounds for deep thinking

    # LLM API key
    QWEN_API_KEY: str = ""
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v3"

    # RAGFlow
    RAGFLOW_BASE_URL: str = "http://ragflow:9380"
    RAGFLOW_API_KEY: str = ""
    RAPTOR_ENABLED: bool = False

    # MinerU
    MINERU_BASE_URL: str = "http://cloud.jototech.cn:17860"

    # Docmee (文多多 AiPPT)
    DOCMEE_API_KEY: str = ""

    # File Storage
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 50

    # Alibaba Cloud TTS
    ALIBABA_TTS_APPKEY: str = os.getenv("ALIBABA_TTS_APPKEY", "")
    ALIBABA_TTS_TOKEN: str = os.getenv("ALIBABA_TTS_TOKEN", "")

    # Volcengine ASR (Seed-ASR 2.0)
    VOLCENGINE_ASR_APPID: str = ""
    VOLCENGINE_ASR_ACCESS_KEY: str = ""  # Access Token from console
    PUBLIC_BASE_URL: str = ""  # Public URL for audio file serving (e.g. http://47.116.199.160)

    # Web Scraper (Jina Reader)
    WEB_SCRAPER_REMOVE_SELECTOR: str = "nav, footer, header, aside, .ads, .sidebar, .advertisement, .ad-wrapper, .recommend, .comments, .comment-section, [role='banner'], [role='navigation'], [role='complementary']"

    # Email (Resend)
    RESEND_API_KEY: str = ""
    RESEND_FROM: str = ""
    APP_BASE_URL: str = "http://10.200.0.112"

    # Legacy SMTP (kept for backward compat, unused if Resend configured)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""

    # Admin
    ADMIN_EMAIL: str = ""
    LOG_RETENTION_DAYS: int = 7

    # Health Alert
    ALERT_EMAIL: str = ""
    ALERT_CHECK_INTERVAL_MINUTES: int = 5

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""
    GOOGLE_PROXY: str = ""

    # Microsoft OAuth (Entra ID / Azure AD)
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""
    MICROSOFT_TENANT_ID: str = "common"
    MICROSOFT_REDIRECT_URI: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
