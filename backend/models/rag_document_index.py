from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, Text
from db import Base


class RagDocumentIndex(Base):
    __tablename__ = "rag_document_index"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False, default=0, index=True)
    content_hash = Column(String(64), nullable=False, index=True)
    chunk_text = Column(Text, nullable=True)
    embedding_json = Column(Text, nullable=True)
    embedding_model = Column(String(255), nullable=True)
    indexed_at = Column(DateTime, server_default=func.now(), onupdate=func.now())