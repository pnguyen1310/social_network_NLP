# routes/users.py
from fastapi import (
    APIRouter, Depends, HTTPException, Query, UploadFile, File, status
)
from sqlalchemy.orm import Session
from sqlalchemy import or_
import os, uuid, mimetypes

from db import get_db
from models.user import User
from routes.auth import current_non_admin_user

router = APIRouter(prefix="/users", tags=["users"])

# --- Đường dẫn upload: .../backend/uploads/avatars ---
# File này đang ở: .../backend/routes/users.py  => dirname(dirname(__file__)) = .../backend
BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
UPLOAD_ROOT = os.path.join(BACKEND_DIR, "uploads")
AVATAR_DIR = os.path.join(UPLOAD_ROOT, "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)

ALLOWED_AVATAR_CT = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


def serialize_user(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "avatar_url": getattr(u, "avatar_url", None),
        "is_admin": bool(getattr(u, "is_admin", False)),
        "date_of_birth": u.date_of_birth.isoformat() if u.date_of_birth else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


# ---------- Basic listing / search ----------
@router.get("/")
def list_users(
    q: str | None = Query(default=None, description="Từ khóa tên/email"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    query = db.query(User).filter(User.is_admin.is_(False))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(User.display_name.ilike(like), User.email.ilike(like)))

    rows = query.order_by(User.id.desc()).limit(limit).all()
    return {"items": [serialize_user(u) for u in rows]}


@router.get("/search")
def search_users(
    q: str | None = Query(default=None, min_length=1, description="Từ khóa tìm kiếm"),
    name: str | None = Query(default=None, min_length=1, description="Alias của q"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    # Hỗ trợ cả q lẫn name để tương thích FE cũ
    term = (q or name or "").strip()
    if not term:
        return {"items": []}

    like = f"%{term}%"
    rows = (
        db.query(User)
        .filter(User.is_admin.is_(False))
        .filter(or_(User.display_name.ilike(like), User.email.ilike(like)))
        .order_by(User.display_name.asc())
        .limit(limit)
        .all()
    )
    return {"items": [serialize_user(u) for u in rows]}


# ---------- Current user ----------
@router.get("/me")
def get_me(
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    return serialize_user(user)


# ---------- User detail ----------
@router.get("/{user_id}")
def get_user_detail(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    u = db.query(User).filter(User.id == user_id, User.is_admin.is_(False)).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return serialize_user(u)


# ---------- Upload / clear Avatar ----------
@router.post("/me/avatar", status_code=status.HTTP_201_CREATED)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    # Validate content-type
    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_AVATAR_CT:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ ảnh PNG/JPG/WebP/GIF")

    # Lấy đuôi file (ưu tiên từ tên), nếu thiếu thì đoán theo content-type
    ext = os.path.splitext(file.filename or "")[1].lower()
    if not ext:
        ext = mimetypes.guess_extension(ct) or ".png"

    # Tạo tên file ngẫu nhiên theo uid
    fname = f"u{user.id}_{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(AVATAR_DIR, fname)

    # Ghi file (giới hạn 10MB)
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ảnh quá lớn (tối đa 10MB)")
    with open(dest_path, "wb") as out:
        out.write(data)
    await file.close()

    # Xóa file cũ nếu có
    old = getattr(user, "avatar_url", None)
    if old and old.startswith("/uploads/avatars/"):
        try:
            os.remove(os.path.join(BACKEND_DIR, old.lstrip("/")))
        except Exception:
            pass

    # Lưu đường dẫn tương đối (được serve qua StaticFiles ở /uploads)
    user.avatar_url = f"/uploads/avatars/{fname}"
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"avatar_url": user.avatar_url}


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    old = getattr(user, "avatar_url", None)
    if not old:
        return

    # Xóa file vật lý nếu nằm trong thư mục avatars
    if old.startswith("/uploads/avatars/"):
        try:
            os.remove(os.path.join(BACKEND_DIR, old.lstrip("/")))
        except Exception:
            pass

    user.avatar_url = None
    db.add(user)
    db.commit()
    return
