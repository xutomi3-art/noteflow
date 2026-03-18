import os
import uuid as _uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.feedback import Feedback
from backend.models.user import User

router = APIRouter(prefix="/feedback", tags=["feedback"])

FEEDBACK_UPLOAD_DIR = os.path.join(settings.UPLOAD_DIR, "feedback")


@router.post("")
async def submit_feedback(
    type: str = Form(...),
    content: str = Form(...),
    screenshot: UploadFile | None = File(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if type not in ("bug", "wish"):
        raise HTTPException(status_code=400, detail="Type must be 'bug' or 'wish'")

    if not content.strip():
        raise HTTPException(status_code=400, detail="Content is required")

    screenshot_url: str | None = None
    if screenshot and screenshot.filename:
        os.makedirs(FEEDBACK_UPLOAD_DIR, exist_ok=True)
        ext = os.path.splitext(screenshot.filename)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"):
            raise HTTPException(status_code=400, detail="Screenshot must be an image file")
        file_id = str(_uuid.uuid4())
        filename = f"{file_id}{ext}"
        file_path = os.path.join(FEEDBACK_UPLOAD_DIR, filename)
        data = await screenshot.read()
        with open(file_path, "wb") as f:
            f.write(data)
        screenshot_url = f"/uploads/feedback/{filename}"

    feedback = Feedback(
        user_id=user.id,
        type=type,
        content=content.strip(),
        screenshot_url=screenshot_url,
        status="open",
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    return {
        "id": str(feedback.id),
        "type": feedback.type,
        "content": feedback.content,
        "screenshot_url": feedback.screenshot_url,
        "status": feedback.status,
        "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
    }
