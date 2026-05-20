from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from db import Base
class Comment(Base):
    __tablename__ = 'comments'
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey('posts.id'), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    post = relationship('Post', back_populates='comments')
    author = relationship('User', back_populates='comments')
