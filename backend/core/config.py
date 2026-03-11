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

    # LLM API (primary: DeepSeek for chat, fallback: Qwen for embedding/vision)
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = "https://api.deepseek.com/v1"
    LLM_MODEL: str = "deepseek-chat"
    LLM_THINKING_MODEL: str = "deepseek-reasoner"

    # Qwen API (kept for embedding + vision, which DeepSeek doesn't offer)
    QWEN_API_KEY: str = ""
    QWEN_MODEL: str = "qwen-plus"
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v3"

    # RAGFlow
    RAGFLOW_BASE_URL: str = "http://ragflow:9380"
    RAGFLOW_API_KEY: str = ""

    # MinerU
    MINERU_BASE_URL: str = "http://mineru:8010"

    # Presenton
    PRESENTON_BASE_URL: str = "http://presenton:80"

    # File Storage
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 50

    # Alibaba Cloud TTS
    ALIBABA_TTS_APPKEY: str = os.getenv("ALIBABA_TTS_APPKEY", "")
    ALIBABA_TTS_TOKEN: str = os.getenv("ALIBABA_TTS_TOKEN", "")

    # SMTP Email
    SMTP_HOST: str = ""
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    APP_BASE_URL: str = "http://10.200.0.112"

    # Admin
    ADMIN_EMAIL: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
