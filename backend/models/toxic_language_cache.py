from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, func

from db import Base


class ToxicLanguageCache(Base):
    __tablename__ = "toxic_language_cache"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    content_hash = Column(String(64), nullable=False, index=True)

    is_toxic = Column(Boolean, nullable=True)
    toxic_score = Column(Float, nullable=True)
    severity = Column(String(20), nullable=True)
    reason = Column(Text, nullable=True)

    categories_json = Column(Text, nullable=True)
    matched_terms_json = Column(Text, nullable=True)

    model = Column(String(120), nullable=True)
    source = Column(String(40), nullable=True)
    error = Column(String(255), nullable=True)
    error_code = Column(String(255), nullable=True)

    analyzed_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
