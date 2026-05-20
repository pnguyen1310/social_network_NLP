# backend/models/post.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, Text
from sqlalchemy.orm import relationship
from db import Base

class Post(Base):
    __tablename__ = 'posts'

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)

    # Cho phép rỗng để có thể đăng bài chỉ có media
    content = Column(Text, nullable=True, default="")

    # Thời gian tạo
    created_at = Column(DateTime, server_default=func.now())

    # Đếm like
    like_count = Column(Integer, default=0)

    # ====== Media (mới) ======
    # VD: "/uploads/2a1f3b...c8.jpg"
    media_url = Column(String(255), nullable=True)
    # "image" | "video"
    media_type = Column(String(10), nullable=True)

    # Liên kết tác giả
    author = relationship('User', back_populates='posts')

    # Liên kết comment (bao gồm comment thường & hệ thống)
    comments = relationship(
        'Comment',
        back_populates='post',
        cascade="all, delete-orphan"
    )
