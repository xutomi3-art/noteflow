from datetime import datetime

from pydantic import BaseModel


class CreateInviteLinkRequest(BaseModel):
    role: str = "viewer"  # editor or viewer


class InviteLinkResponse(BaseModel):
    id: str
    token: str
    role: str
    expires_at: datetime | None = None
    created_at: datetime


class MemberResponse(BaseModel):
    user_id: str
    name: str
    email: str
    avatar: str | None = None
    role: str
    joined_at: datetime


class UpdateMemberRoleRequest(BaseModel):
    role: str  # editor or viewer


class TransferOwnershipRequest(BaseModel):
    new_owner_id: str
