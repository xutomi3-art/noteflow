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

    # Qwen API
    QWEN_API_KEY: str = ""
    QWEN_MODEL: str = "qwen-plus"
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v3"

    # RAGFlow
    RAGFLOW_BASE_URL: str = "http://ragflow:9380"
    RAGFLOW_API_KEY: str = ""

    # MinerU
    MINERU_BASE_URL: str = "http://mineru:8010"

    # File Storage
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 50

    # Alibaba Cloud TTS
    ALIBABA_TTS_APPKEY: str = os.getenv("ALIBABA_TTS_APPKEY", "")
    ALIBABA_TTS_TOKEN: str = os.getenv("ALIBABA_TTS_TOKEN", "")

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
