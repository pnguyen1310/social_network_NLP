# services/notify.py
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import logging
import asyncio
from models.notification import Notification
from realtime import manager

logger = logging.getLogger(__name__)

def send_notification(
    db: Session,
    *,
    user_id: int,          # người nhận (chủ bài viết)
    actor_id: int,         # người hành động
    post_id: int | None,   # bài viết liên quan (có thể None nếu bài đã bị xóa)
    notif_type: str,       # "like" | "comment"
    text: str | None = None,
    dedupe: bool = True,   # like → chỉ 1 bản, comment → cho phép nhiều (dedupe=False)
):
    noti = None
    
    try:
        if dedupe:
            # cập nhật nếu đã tồn tại
            noti = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user_id,
                    Notification.actor_id == actor_id,
                    Notification.post_id == post_id,
                    Notification.type == notif_type,
                )
                .first()
            )
            if noti:
                noti.is_read = False
                db.commit()
                db.refresh(noti)
            else:
                noti = Notification(
                    user_id=user_id,
                    actor_id=actor_id,
                    post_id=post_id,
                    type=notif_type,
                    text=text,
                )
                db.add(noti)
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                    # có thể đã có unique -> bỏ qua
                    logger.warning(f"Notification already exists: {user_id}, {actor_id}, {post_id}, {notif_type}")
                    return
                db.refresh(noti)
        else:
            noti = Notification(
                user_id=user_id,
                actor_id=actor_id,
                post_id=post_id,
                type=notif_type,
                text=text,
            )
            db.add(noti)
            try:
                db.commit()
                db.refresh(noti)
            except IntegrityError as e:
                # Constraint violation - notification already exists
                db.rollback()
                logger.warning(f"Notification constraint violation: {user_id}, {actor_id}, {post_id}, {notif_type}")
                # Try to fetch the existing one
                noti = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == user_id,
                        Notification.actor_id == actor_id,
                        Notification.post_id == post_id,
                        Notification.type == notif_type,
                    )
                    .first()
                )
                if not noti:
                    logger.error(f"Could not find or create notification: {user_id}, {actor_id}, {post_id}, {notif_type}")
                    return

        # Bắn realtime
        if noti:
            try:
                payload = {
                    "event": "notification",
                    "id": noti.id,
                    "type": noti.type,
                    "text": noti.text or "",
                    "post_id": noti.post_id,
                    "actor_id": noti.actor_id,
                    "created_at": noti.created_at.isoformat() if noti.created_at else None,
                }

                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(manager.send_to_user(user_id, payload))
                except RuntimeError:
                    # Called from sync worker thread: run a short-lived loop for realtime push.
                    asyncio.run(manager.send_to_user(user_id, payload))
            except Exception as e:
                logger.error(f"Failed to broadcast notification: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Error in send_notification: {e}", exc_info=True)
        raise
