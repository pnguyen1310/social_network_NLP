from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from db import Base

class Report(Base):
    __tablename__ = 'reports'
    
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    reporter_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    reason = Column(String(500), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    
    # Relationships
    post = relationship('Post', backref='reports')
    reporter = relationship('User', backref='reports')
