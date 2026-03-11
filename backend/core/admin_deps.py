from fastapi import Depends, HTTPException

from backend.core.deps import get_current_user
from backend.models.user import User


async def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
