from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, Float
from db import Base


class PostSentimentCache(Base):
    __tablename__ = "post_sentiment_cache"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    content_hash = Column(String(64), nullable=False, index=True)
    sentiment_label = Column(String(64), nullable=True)
    sentiment_label_id = Column(Integer, nullable=True)
    sentiment_score = Column(Float, nullable=True)
    model_ref = Column(String(255), nullable=True)
    analyzed_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
