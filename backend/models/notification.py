# models/notification.py
from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
    func,
)
from sqlalchemy.orm import relationship
from db import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)

    # Người nhận thông báo (VD: chủ bài viết được like/comment)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Người thực hiện hành động (VD: người like hoặc comment)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Bài viết liên quan (có thể None với một số loại noti như follow)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=True, index=True)

    # Loại thông báo: "like" | "comment" | "follow" | ...
    type = Column(String(20), nullable=False)

    # Nội dung hiển thị ngắn gọn (tuỳ chọn)
    text = Column(String(255), nullable=True)

    # Đã đọc?
    is_read = Column(Boolean, default=False, nullable=False)

    # Thời gian tạo
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Chống trùng: 1 (user_id, actor_id, post_id, type) chỉ tạo 1 thông báo
    __table_args__ = (
        UniqueConstraint("user_id", "actor_id", "post_id", "type", name="uq_notification_once"),
        # Index phổ biến để load nhanh danh sách thông báo chưa đọc mới nhất
        Index("ix_notification_user_unread_created", "user_id", "is_read", "created_at"),
    )

    # -------- Relationships --------
    user = relationship("User", foreign_keys=[user_id], backref="notifications_received")
    actor = relationship("User", foreign_keys=[actor_id], backref="notifications_sent")
    post = relationship("Post", backref="notifications")

    # -------- Helpers --------
    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "actor_id": self.actor_id,
            "post_id": self.post_id,
            "type": self.type,
            "text": self.text,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:  # tiện debug
        return f"<Notification id={self.id} user={self.user_id} actor={self.actor_id} type={self.type}>"
