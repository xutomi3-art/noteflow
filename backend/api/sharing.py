import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.sharing import (
    CreateInviteLinkRequest,
    InviteLinkResponse,
    MemberResponse,
    UpdateMemberRoleRequest,
    TransferOwnershipRequest,
)
from backend.services import sharing_service, permission_service

router = APIRouter(tags=["sharing"])


# --- Invite Links ---

@router.post("/notebooks/{notebook_id}/share", response_model=InviteLinkResponse)
async def create_invite_link(
    notebook_id: str,
    req: CreateInviteLinkRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "share"):
        raise HTTPException(status_code=403, detail="No permission to share")

    if req.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be 'editor' or 'viewer'")

    link = await sharing_service.create_invite_link(db, uuid.UUID(notebook_id), user.id, req.role)
    return InviteLinkResponse(
        id=str(link.id),
        token=link.token,
        role=link.role,
        expires_at=link.expires_at,
        created_at=link.created_at,
    )


@router.delete("/notebooks/{notebook_id}/share")
async def stop_sharing(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "delete"):
        raise HTTPException(status_code=403, detail="Only the owner can stop sharing")

    await sharing_service.stop_sharing(db, uuid.UUID(notebook_id))
    return {"data": {"message": "Sharing stopped"}}


# --- Join ---

@router.post("/join/{token}")
async def join_via_token(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await sharing_service.join_via_token(db, token, user.id)
    if result is None:
        raise HTTPException(status_code=404, detail="Invalid or expired invite link")
    return {"data": result}


# --- Members ---

@router.get("/notebooks/{notebook_id}/members", response_model=list[MemberResponse])
async def get_members(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "view"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    members = await sharing_service.get_members(db, uuid.UUID(notebook_id))
    return [MemberResponse(**m) for m in members]


@router.patch("/notebooks/{notebook_id}/members/{target_user_id}")
async def update_member_role(
    notebook_id: str,
    target_user_id: str,
    req: UpdateMemberRoleRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "manage_members"):
        raise HTTPException(status_code=403, detail="Only the owner can manage members")

    if req.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be 'editor' or 'viewer'")

    success = await sharing_service.update_member_role(
        db, uuid.UUID(notebook_id), uuid.UUID(target_user_id), req.role
    )
    if not success:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"data": {"message": "Role updated"}}


@router.delete("/notebooks/{notebook_id}/members/{target_user_id}")
async def remove_member(
    notebook_id: str,
    target_user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "manage_members"):
        raise HTTPException(status_code=403, detail="Only the owner can remove members")

    success = await sharing_service.remove_member(db, uuid.UUID(notebook_id), uuid.UUID(target_user_id))
    if not success:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"data": {"message": "Member removed"}}


@router.post("/notebooks/{notebook_id}/leave")
async def leave_notebook(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await permission_service.get_user_role(db, uuid.UUID(notebook_id), user.id)
    if role is None:
        raise HTTPException(status_code=404, detail="Not a member")
    if role == "owner":
        raise HTTPException(status_code=400, detail="Owner cannot leave. Transfer ownership first.")

    success = await sharing_service.leave_notebook(db, uuid.UUID(notebook_id), user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Not a member")
    return {"data": {"message": "Left notebook"}}


@router.patch("/notebooks/{notebook_id}/owner")
async def transfer_ownership(
    notebook_id: str,
    req: TransferOwnershipRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "transfer"):
        raise HTTPException(status_code=403, detail="Only the owner can transfer ownership")

    success = await sharing_service.transfer_ownership(
        db, uuid.UUID(notebook_id), user.id, uuid.UUID(req.new_owner_id)
    )
    if not success:
        raise HTTPException(status_code=400, detail="Target user is not a member")
    return {"data": {"message": "Ownership transferred"}}
