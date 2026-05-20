# models/user.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, Date, DateTime, Boolean,
    func, text, UniqueConstraint, Index
)
from sqlalchemy.orm import relationship

from db import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        Index("ix_users_email", "email"),
        Index("ix_users_display_name", "display_name"),
    )

    # ====== Cột dữ liệu chính ======
    id = Column(Integer, primary_key=True, index=True)

    # Email duy nhất
    email = Column(String(255), unique=True, nullable=False)

    # Mật khẩu đã băm (hash bởi passlib[bcrypt] ở layer services/routes)
    password_hash = Column(String(255), nullable=False)

    # Tên hiển thị
    display_name = Column(String(120), nullable=False)

    # Ảnh đại diện (đường dẫn được serve qua /uploads/avatars/...)
    avatar_url = Column(String(255), nullable=True)

    # Quyền admin cơ bản (xóa bài, quản trị…)
    # PostgreSQL: dùng server_default để đảm bảo giá trị mặc định ở mức DB
    is_admin = Column(Boolean, nullable=False, server_default=text("false"))

    # Ngày sinh (tùy chọn)
    date_of_birth = Column(Date, nullable=True)

    # Thời điểm tạo/cập nhật
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # ====== Quan hệ Bài viết / Bình luận ======
    # Post.author -> User
    posts = relationship(
        "Post",
        back_populates="author",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )

    # Comment.author -> User
    comments = relationship(
        "Comment",
        back_populates="author",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )

    # ====== Quan hệ Hệ thống bạn bè (tránh import vòng lặp bằng string) ======
    # FriendRequest.sender -> User
    sent_requests = relationship(
        "FriendRequest",
        foreign_keys="FriendRequest.sender_id",   # tránh import trực tiếp
        back_populates="sender",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        overlaps="friend_requests_sent_rel",
    )

    # FriendRequest.receiver -> User
    received_requests = relationship(
        "FriendRequest",
        foreign_keys="FriendRequest.receiver_id",
        back_populates="receiver",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        overlaps="friend_requests_received_rel",
    )

    # Friendship.user -> User (danh sách bạn đã kết bạn)
    friends = relationship(
        "Friendship",
        foreign_keys="Friendship.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        overlaps="friendships_rel",
    )

    # ====== Tiện ích ======
    def __repr__(self) -> str:  # giúp debug/log đẹp hơn
        return f"<User id={self.id} email={self.email} admin={bool(getattr(self, 'is_admin', False))}>"
