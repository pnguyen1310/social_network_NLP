# models/friend.py
from sqlalchemy import (
    Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, func
)
from sqlalchemy.orm import relationship
from db import Base


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id = Column(Integer, primary_key=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    receiver_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # LƯU CHUỖI: 'pending' | 'accepted' | 'rejected'
    status = Column(String(20), nullable=False, server_default="pending", default="pending", index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sender = relationship("User", foreign_keys=[sender_id], backref="friend_requests_sent_rel")
    receiver = relationship("User", foreign_keys=[receiver_id], backref="friend_requests_received_rel")

    __table_args__ = (
        UniqueConstraint("sender_id", "receiver_id", name="uq_friend_request_pair"),
    )


class Friendship(Base):
    __tablename__ = "friendships"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    friend_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id], backref="friendships_rel")
    friend = relationship("User", foreign_keys=[friend_id], backref="friends_of_rel")

    __table_args__ = (
        UniqueConstraint("user_id", "friend_id", name="uq_friendship_pair"),
    )
