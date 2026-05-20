from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, Text
from db import Base


class ImageAnalysisCache(Base):
    __tablename__ = "image_analysis_cache"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    media_url = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    description_model = Column(String(120), nullable=True)
    description_mode = Column(String(40), nullable=True)
    description_error = Column(String(255), nullable=True)
    description_error_code = Column(String(255), nullable=True)
    analyzed_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
