# routes/notifications.py
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from models.notification import Notification
from routes.auth import current_non_admin_user
from models.user import User  # chỉ để gợi ý kiểu

router = APIRouter(prefix="/notifications", tags=["notifications"])


def serialize_notification(n: Notification) -> dict:
    return {
        "id": n.id,
        "user_id": n.user_id,
        "actor_id": n.actor_id,
        "post_id": n.post_id,
        "type": n.type,
        "text": n.text,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("")
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(True, description="Chỉ trả về thông báo chưa đọc"),
):
    """
    Lấy danh sách thông báo của user hiện tại.
    - unread_only=True (mặc định): chỉ trả thông báo chưa đọc
    - Có phân trang page/limit
    """
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.is_read == False)  # noqa: E712

    items = (
        q.order_by(Notification.created_at.desc())
         .offset((page - 1) * limit)
         .limit(limit)
         .all()
    )
    return {"items": [serialize_notification(n) for n in items]}


# --- Mark all read (chuẩn) ---
@router.put("/mark_all_read", status_code=status.HTTP_200_OK)
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    """
    Đánh dấu tất cả thông báo của user hiện tại là đã đọc.
    """
    q = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.is_read == False,  # noqa: E712
    )
    count = q.update({Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return {"message": f"Đã đánh dấu {count} thông báo là đã đọc"}


# --- Tương thích FE cũ: POST /notifications/mark-read ---
@router.post("/mark-read", status_code=status.HTTP_200_OK)
def mark_read_compat(
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    """
    Bản tương thích: cùng chức năng với /mark_all_read nhưng method/đường dẫn cũ.
    """
    q = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.is_read == False,  # noqa: E712
    )
    count = q.update({Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return {"message": f"Đã đánh dấu {count} thông báo là đã đọc"}


@router.put("/{noti_id}/read", status_code=status.HTTP_200_OK)
def mark_one_read(
    noti_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    """
    Đánh dấu 1 thông báo là đã đọc (theo id).
    """
    noti = (
        db.query(Notification)
        .filter(Notification.id == noti_id, Notification.user_id == user.id)
        .first()
    )
    if not noti:
        raise HTTPException(status_code=404, detail="Notification not found")

    if not noti.is_read:
        noti.is_read = True
        db.commit()

    return {"message": "Marked as read", "notification": serialize_notification(noti)}
