from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, Text
from db import Base


class OverallAnalysisCache(Base):
    __tablename__ = "overall_analysis_cache"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    input_hash = Column(String(64), nullable=False, index=True)
    payload = Column(Text, nullable=False)
    cache_version = Column(String(40), nullable=False, default="v1")
    analyzed_at = Column(DateTime, server_default=func.now(), onupdate=func.now())