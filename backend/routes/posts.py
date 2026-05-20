# backend/routes/posts.py
from fastapi import (
    APIRouter, Depends, HTTPException, Query, status, Request
)
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
import logging
import os, uuid, mimetypes

from db import get_db
from models.user import User
from models.post import Post
from models.comment import Comment
from models.report import Report
from routes.auth import current_non_admin_user

from services.notify import send_notification
from realtime import manager

router = APIRouter(prefix="/posts", tags=["posts"])

# --- Upload dir: .../backend/uploads (khớp main.py) ---
BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))  # .../backend
UPLOAD_DIR = os.path.join(BACKEND_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_CT = {
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
    "video/mp4", "video/quicktime", "video/webm",
}

# ===== Schemas =====
class PostIn(BaseModel):
    content: str | None = ""  # (tham khảo)

class CommentIn(BaseModel):
    content: str

# ===== Serializers =====
def serialize_author(u: User) -> dict | None:
    if not u:
        return None
    return {
        "id": u.id,
        "display_name": u.display_name,
        "email": u.email,
        "avatar_url": getattr(u, "avatar_url", None),
        "is_admin": bool(getattr(u, "is_admin", False)),
    }

def serialize_comment(c: Comment) -> dict:
    return {
        "id": c.id,
        "content": c.content,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "author": serialize_author(c.author),
    }

def serialize_post(p: Post, liked_by_me: bool = False) -> dict:
    """Trả post kèm trạng thái đã like của current user."""
    # Đếm comment thực (loại bỏ "__LIKE__")
    real_comments = [c for c in (p.comments or []) if c.content != "__LIKE__"]
    return {
        "id": p.id,
        "content": p.content,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "like_count": int(p.like_count or 0),
        "comment_count": len(real_comments),
        "liked_by_me": bool(liked_by_me),
        "media_url": p.media_url,
        "media_type": p.media_type,  # "image" | "video" | None
        "author": serialize_author(p.author),  # <— có avatar_url
    }

# ===== Helpers =====
def _pick_upload_from_form(form):
    """
    Lấy UploadFile đầu tiên từ form (hỗ trợ media/file/media[] và cả list).
    Trả về (upload_file | None).
    """
    for key in ("media", "file", "media[]"):
        val = form.get(key)
        if val is None:
            continue
        if isinstance(val, list):
            for item in val:
                if getattr(item, "filename", None):
                    return item
        else:
            if getattr(val, "filename", None):
                return val
    # Quét toàn bộ form (phòng TH tên field khác)
    for _, v in form.multi_items():
        if getattr(v, "filename", None):
            return v
    return None


def _safe_remove_media_file(media_url: str | None) -> None:
    """
    Xóa file media trên đĩa nếu tồn tại. Chỉ cho phép xóa trong thư mục uploads.
    """
    if not media_url:
        return
    if not media_url.startswith("/uploads/"):
        return
    fname = media_url.split("/uploads/", 1)[-1]
    if "/" in fname or "\\" in fname:
        return
    fpath = os.path.join(UPLOAD_DIR, fname)
    if os.path.isfile(fpath):
        try:
            os.remove(fpath)
        except OSError:
            pass


# ===== ROUTES =====
@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_post(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    """
    Hỗ trợ:
    - JSON:   {"content": "..."}
    - multipart/form-data: content=<text>, media=<file image/video>
    """
    ct = (request.headers.get("content-type") or "").lower()

    content: str = ""
    media_url: str | None = None
    media_type: str | None = None

    if "multipart/form-data" in ct:
        form = await request.form()
        content = (form.get("content") or "").strip()

        file = _pick_upload_from_form(form)
        if file and getattr(file, "filename", ""):
            f_ct = (getattr(file, "content_type", "") or "").lower()
            if f_ct not in ALLOWED_CT:
                raise HTTPException(status_code=400, detail="Unsupported file type")

            ext = os.path.splitext(file.filename or "")[1].lower()
            if not ext:
                ext = mimetypes.guess_extension(f_ct) or ""

            fname = f"{uuid.uuid4().hex}{ext}"
            dest_path = os.path.join(UPLOAD_DIR, fname)

            data = await file.read()
            with open(dest_path, "wb") as out:
                out.write(data)
            await file.close()

            media_url = f"/uploads/{fname}"
            media_type = "video" if f_ct.startswith("video/") else "image"
    else:
        try:
            data = await request.json()
        except Exception:
            data = {}
        content = (data.get("content") or "").strip()

    p = Post(
        author_id=user.id,
        content=content or "",
        media_url=media_url,
        media_type=media_type,
    )
    db.add(p)
    db.commit()

    # Auto-scan toxic language right after post creation (text-only).
    normalized_content = (content or "").strip()
    if normalized_content:
        try:
            from routes.admin import _analyze_toxic_vietnamese_text_with_groq, _upsert_toxic_language_cache

            analysis = _analyze_toxic_vietnamese_text_with_groq(normalized_content)
            _upsert_toxic_language_cache(db=db, post_id=int(p.id), content=normalized_content, analysis=analysis)

            score = analysis.get("toxic_score")
            is_toxic = bool(analysis.get("is_toxic"))
            has_severe_score = isinstance(score, (int, float)) and float(score) >= 0.55
            matched_terms = analysis.get("matched_terms") if isinstance(analysis.get("matched_terms"), list) else []

            if is_toxic and (has_severe_score or bool(matched_terms)):
                send_notification(
                    db=db,
                    user_id=user.id,
                    actor_id=user.id,
                    post_id=int(p.id),
                    notif_type="toxic_flagged",
                    text="Bài viết của bạn có dấu hiệu chứa ngôn ngữ không phù hợp. Nội dung sẽ được chuyển đến quản trị viên để xem xét trong thời gian sớm nhất.",
                    dedupe=True,
                )
        except Exception:
            logging.warning("Auto toxic scan failed for post_id=%s", p.id, exc_info=True)

    # load kèm author để trả về đầy đủ avatar_url
    p = db.query(Post).options(joinedload(Post.author)).get(p.id)
    return serialize_post(p, liked_by_me=False)


@router.get("/")
def list_posts(
    # ✅ Hỗ trợ cả author_id (mới) lẫn user_id (tương thích ngược)
    author_id: int | None = Query(default=None, description="Lọc theo tác giả"),
    user_id: int | None = Query(default=None, description="(deprecated) alias của author_id"),
    limit: int = Query(20, ge=1, le=100),
    page: int = Query(1, ge=1),
    offset: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    q = (
        db.query(Post)
        .join(User, User.id == Post.author_id)
        .filter(User.is_admin.is_(False))
        .options(joinedload(Post.author))
        .order_by(Post.id.desc())
    )

    author = author_id or user_id
    if author:
        q = q.filter(Post.author_id == author)

    start = offset if offset is not None else (page - 1) * limit
    rows = q.offset(start).limit(limit).all()

    items: list[dict] = []
    for p in rows:
        liked = db.query(Comment.id).filter(
            Comment.post_id == p.id,
            Comment.author_id == user.id,
            Comment.content == "__LIKE__",
        ).first() is not None
        items.append(serialize_post(p, liked_by_me=liked))
    return {"items": items}


@router.post("/{post_id}/like")
def toggle_like(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    existing = (
        db.query(Comment)
        .filter(
            Comment.post_id == post_id,
            Comment.author_id == user.id,
            Comment.content == "__LIKE__",
        )
        .first()
    )

    if existing:
        # UNLIKE
        db.delete(existing)
        post.like_count = max(0, int(post.like_count or 1) - 1)
        liked_by_me = False
        db.commit()
        db.refresh(post)
    else:
        # LIKE
        like_mark = Comment(post_id=post.id, author_id=user.id, content="__LIKE__")
        db.add(like_mark)
        post.like_count = int(post.like_count or 0) + 1
        liked_by_me = True
        db.commit()
        db.refresh(post)

        if post.author_id != user.id:
            send_notification(
                db=db,
                user_id=post.author_id,
                actor_id=user.id,
                post_id=post.id,
                notif_type="like",
                text=f"{user.display_name} đã thích bài viết của bạn.",
                dedupe=True,
            )

    manager.send_to_user(
        post.author_id,
        {"event": "post_updated", "post_id": post.id, "like_count": int(post.like_count or 0)},
    )
    return {"like_count": int(post.like_count or 0), "liked_by_me": liked_by_me}


@router.get("/{post_id}/comments")
def list_comments(post_id: int, db: Session = Depends(get_db)):
    comments = (
        db.query(Comment)
        .options(joinedload(Comment.author))
        .filter(
            Comment.post_id == post_id,
            Comment.content != "__LIKE__",
        )
        .order_by(Comment.id.asc())
        .all()
    )
    return [serialize_comment(c) for c in comments]


@router.post("/{post_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    post_id: int,
    payload: CommentIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    c = Comment(post_id=post.id, author_id=user.id, content=(payload.content or "").strip())
    db.add(c)
    db.commit()
    c = db.query(Comment).options(joinedload(Comment.author)).get(c.id)

    if post.author_id != user.id:
        preview = (payload.content or "").strip()
        if len(preview) > 40:
            preview = preview[:40] + "…"
        send_notification(
            db=db,
            user_id=post.author_id,
            actor_id=user.id,
            post_id=post.id,
            notif_type="comment",
            text=f"{user.display_name} đã bình luận: {preview}",
            dedupe=False,
        )

    manager.send_to_user(post.author_id, {"event": "post_updated", "post_id": post.id})
    return serialize_comment(c)


# =========================
#       DELETE POST
# =========================

ALLOW_ADMIN_DELETE = False  # bật True nếu muốn admin xoá được

@router.put("/{post_id}")
async def update_post(
    post_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    """Update post content (only for owner)"""
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if post.author_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    ct = request.headers.get("content-type", "").lower()
    content = ""

    if "multipart/form-data" in ct:
        form = await request.form()
        content = (form.get("content") or "").strip()
    else:
        try:
            body = await request.json()
            content = (body.get("content") or "").strip()
        except:
            pass

    # Update content
    post.content = content
    db.commit()
    db.refresh(post)

    return serialize_post(post, liked_by_me=False)

@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    is_owner = (post.author_id == user.id)
    is_admin = bool(getattr(user, "is_admin", False)) and ALLOW_ADMIN_DELETE
    if not (is_owner or is_admin):
        raise HTTPException(status_code=403, detail="Forbidden")

    _safe_remove_media_file(post.media_url)

    try:
        db.delete(post)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete this post due to related data")

    manager.send_to_user(post.author_id, {"event": "post_deleted", "post_id": post_id})
    return

# ===== REPORT POST =====
@router.post("/{post_id}/report")
def report_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    """Report a post"""
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if already reported by this user
    existing = db.query(Report).filter(
        Report.post_id == post_id,
        Report.reporter_id == user.id
    ).first()
    
    if existing:
        return {"message": "Already reported"}
    
    # Create report
    report = Report(post_id=post_id, reporter_id=user.id)
    db.add(report)
    db.commit()
    
    return {"message": "Report submitted successfully"}

