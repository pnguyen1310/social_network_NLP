from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import unicodedata
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from db import get_db
from models.overall_analysis_cache import OverallAnalysisCache
from models.post import Post
from models.user import User
from models.post_sentiment_cache import PostSentimentCache
from models.rag_document_index import RagDocumentIndex
from routes.admin import (
    GROQ_FUSION_MODEL,
    _groq_chat_completion,
    _normalize_to_three_label,
    _normalize_post_text,
    admin_required,
)

router = APIRouter(prefix="/admin", tags=["admin-rag"])

GROQ_API_KEY_RAG = os.getenv("GROQ_API_KEY_RAG", "").strip() or os.getenv("GROQ_API_KEY", "").strip()
RAG_EMBEDDING_MODEL = os.getenv(
    "RAG_EMBEDDING_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
).strip()
RAG_RERANK_MODEL = os.getenv(
    "RAG_RERANK_MODEL",
    "cross-encoder/ms-marco-MiniLM-L-6-v2",
).strip()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        return int(str(raw).strip() or default)
    except Exception:
        return default


RAG_DOCUMENT_LIMIT = _env_int("RAG_DOCUMENT_LIMIT", 0)
RAG_RETRIEVAL_TOP_K = max(1, _env_int("RAG_RETRIEVAL_TOP_K", 12))
RAG_MAX_QUESTION_CHARS = max(80, _env_int("RAG_MAX_QUESTION_CHARS", 1200))
RAG_CHUNK_SIZE = max(100, _env_int("RAG_CHUNK_SIZE", 200))
RAG_CHUNK_OVERLAP = max(0, _env_int("RAG_CHUNK_OVERLAP", 50))
RAG_RERANK_TOP_K = max(1, _env_int("RAG_RERANK_TOP_K", 5))
RAG_RECENCY_WEIGHT = min(max(float(os.getenv("RAG_RECENCY_WEIGHT", "0.15") or 0.15), 0.0), 0.5)


def _normalize_question(text: str) -> str:
    cleaned = _normalize_post_text(text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:RAG_MAX_QUESTION_CHARS]

def _normalize_search_text(text: str) -> str:
    base = (text or "").strip().lower()
    no_mark = "".join(ch for ch in unicodedata.normalize("NFD", base) if unicodedata.category(ch) != "Mn")
    no_mark = no_mark.replace("đ", "d")
    return re.sub(r"\s+", " ", no_mark).strip()


def _content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _chunk_text(text: str, chunk_size: int = RAG_CHUNK_SIZE, overlap: int = RAG_CHUNK_OVERLAP) -> List[str]:
    if not text:
        return []
    
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        start += chunk_size - overlap
        if start >= len(words):
            break
    return chunks


@lru_cache(maxsize=1)
def _get_reranker_backend():
    try:
        from sentence_transformers import CrossEncoder
    except Exception as e:
        raise RuntimeError("reranker_backend_unavailable") from e

    model = CrossEncoder(RAG_RERANK_MODEL)
    return {"model": model}


@lru_cache(maxsize=1)
def _get_embedding_backend():
    try:
        from transformers import AutoModel, AutoTokenizer
        import torch
    except Exception as e:
        raise RuntimeError("embedding_backend_unavailable") from e

    tokenizer = AutoTokenizer.from_pretrained(RAG_EMBEDDING_MODEL)
    model = AutoModel.from_pretrained(RAG_EMBEDDING_MODEL)
    model.eval()
    return {"tokenizer": tokenizer, "model": model, "torch": torch}


def _embed_texts(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []

    backend = _get_embedding_backend()
    tokenizer = backend["tokenizer"]
    model = backend["model"]
    torch = backend["torch"]

    encoded = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**encoded)

    token_embeddings = outputs.last_hidden_state
    attention_mask = encoded["attention_mask"].unsqueeze(-1)
    masked_embeddings = token_embeddings * attention_mask
    summed = masked_embeddings.sum(dim=1)
    counts = attention_mask.sum(dim=1).clamp(min=1)
    mean_pooled = summed / counts

    normalized = torch.nn.functional.normalize(mean_pooled, p=2, dim=1)
    return normalized.cpu().tolist()


def _cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    return float(sum(a * b for a, b in zip(vec_a, vec_b)))


def _parse_iso_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _compute_doc_recency_scores(docs: List[Dict[str, Any]]) -> Dict[int, float]:
    recency_dates: Dict[int, datetime] = {}
    for doc in docs:
        post_id = int(doc.get("post_id") or 0)
        created_at = _parse_iso_datetime(str(doc.get("created_at") or ""))
        if post_id > 0 and created_at:
            recency_dates[post_id] = created_at

    if not recency_dates:
        return {}

    min_dt = min(recency_dates.values())
    max_dt = max(recency_dates.values())
    if min_dt >= max_dt:
        return {post_id: 1.0 for post_id in recency_dates}

    span = (max_dt - min_dt).total_seconds()
    result: Dict[int, float] = {}
    for post_id, dt in recency_dates.items():
        normalized = max(0.0, min(1.0, (dt - min_dt).total_seconds() / span))
        result[post_id] = normalized
    return result


def _normalize_scores(chunks: List[Dict[str, Any]], score_key: str = "score", normalized_key: str = "_normalized_score") -> None:
    if not chunks:
        return

    values = [float(chunk.get(score_key) or 0.0) for chunk in chunks]
    min_value = min(values)
    max_value = max(values)
    if max_value <= min_value:
        for chunk in chunks:
            chunk[normalized_key] = 1.0
        return

    span = max_value - min_value
    for chunk, value in zip(chunks, values):
        chunk[normalized_key] = max(0.0, min(1.0, (value - min_value) / span))


def _rerank_chunks(question: str, chunks: List[Dict[str, Any]], top_k: int = RAG_RERANK_TOP_K) -> List[Dict[str, Any]]:
    if not chunks:
        return []

    backend = _get_reranker_backend()
    model = backend["model"]

    pairs = [(question, chunk["chunk_text"]) for chunk in chunks]
    scores = model.predict(pairs)

    for chunk, score in zip(chunks, scores):
        chunk["score"] = float(score)

    chunks.sort(key=lambda x: x["score"], reverse=True)
    result = chunks[:top_k]
    _normalize_scores(result, score_key="score", normalized_key="_normalized_score")
    return result


def _clean_rag_answer_text(answer: str) -> str:
    text = str(answer or "").replace("\r\n", "\n").strip()
    if not text:
        return ""

    remove_patterns = [
        r"\(\s*không có post[_\s-]*id liên quan\s*\)",
        r"\(\s*khong co post[_\s-]*id lien quan\s*\)",
        r"không có post[_\s-]*id liên quan\.?",
        r"khong co post[_\s-]*id lien quan\.?",
        r"post[_\s-]*id\s*lien\s*quan\s*:\s*khong\s*co\.?",
        r"post[_\s-]*id\s*liên\s*quan\s*:\s*không\s*có\.?",
        r"post[_\s-]*id\s*related\s*:\s*(none|n/?a)\.?",
        r"\(\s*post[_\s-]*id\s*lien\s*quan\s*:\s*khong\s*co\s*\)",
        r"\(\s*post[_\s-]*id\s*liên\s*quan\s*:\s*không\s*có\s*\)",
    ]
    for pattern in remove_patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)

    # Remove internal grounding jargon if the model leaks it.
    text = re.sub(
        r"(?i)dựa\s+trên\s+dữ\s+liệu\s+từ\s*[`'\"]?database[_\s-]*facts[`'\"]?\s*và\s*[`'\"]?context[_\s-]*documents[`'\"]?\s*[,.:;-]*",
        "",
        text,
    )
    text = re.sub(
        r"(?i)from\s*[`'\"]?database[_\s-]*facts[`'\"]?\s*and\s*[`'\"]?context[_\s-]*documents[`'\"]?\s*[,.:;-]*",
        "",
        text,
    )

    # Keep readable multiline layout for FE renderer.
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n")]
    lines = [re.sub(r"\s+([,.;:!?])", r"\1", ln) for ln in lines]

    out: List[str] = []
    blank = False
    for ln in lines:
        if not ln:
            if not blank:
                out.append("")
            blank = True
            continue
        out.append(ln)
        blank = False

    cleaned = "\n".join(out).strip()
    return cleaned


def _extract_sentiment_from_query(question: str) -> Optional[str]:
    q = (question or "").lower()
    if any(k in q for k in ["tiêu cực", "tieu cuc", "negative", "neg"]):
        return "NEGATIVE"
    if any(k in q for k in ["tích cực", "tich cuc", "positive", "pos"]):
        return "POSITIVE"
    if any(k in q for k in ["trung tính", "trung tinh", "neutral"]):
        return "NEUTRAL"
    return None


def _is_system_data_question(question: str) -> bool:
    q = _normalize_search_text(question)
    if not q:
        return False

    keywords = [
        "du lieu", "he thong", "admin", "rag",
        "post", "bai viet", "bai", "post_id",
        "user", "nguoi dung", "tai khoan", "dang ky",
        "sentiment", "cam xuc", "tieu cuc", "tich cuc", "trung tinh",
        "media", "anh", "video", "caption",
        "like", "comment", "bao cao", "phan tich", "thong ke",
        "gan day", "moi nhat", "top",
    ]
    if any(k in q for k in keywords):
        return True

    # Explicit reference to post ids should always be treated as system-data intent.
    if re.search(r"\b(?:post[_\s-]*id|bai)\s*#?\s*\d+\b", q, flags=re.IGNORECASE):
        return True

    return False


def _find_target_author(question: str, docs: List[Dict[str, Any]]) -> Optional[str]:
    qn = _normalize_search_text(question)
    if not qn:
        return None

    authors = [str(d.get("author") or "").strip() for d in docs if str(d.get("author") or "").strip()]
    if not authors:
        return None

    unique_authors = sorted(set(authors), key=lambda x: len(x), reverse=True)
    normalized = [(a, _normalize_search_text(a)) for a in unique_authors]

    # Strong match: full display name appears in question.
    for display, norm_name in normalized:
        if norm_name and norm_name in qn:
            return display

    # Soft token-overlap match for phrases like "theo user Phuc Nguyen".
    q_tokens = set(t for t in re.findall(r"[a-z0-9_]+", qn) if len(t) > 1)
    best_name: Optional[str] = None
    best_score = 0.0
    for display, norm_name in normalized:
        name_tokens = [t for t in re.findall(r"[a-z0-9_]+", norm_name) if len(t) > 1]
        if not name_tokens:
            continue
        overlap = len(q_tokens.intersection(set(name_tokens)))
        score = overlap / len(set(name_tokens))
        if overlap >= 1 and score > best_score:
            best_score = score
            best_name = display

    return best_name if best_score >= 0.6 else None


def _build_doc_text(doc: Dict[str, Any]) -> str:
    parts = [
        f"post_id: {doc.get('post_id')}",
        f"author: {doc.get('author') or ''}",
        f"caption: {doc.get('caption') or ''}",
        f"overall_sentiment: {doc.get('overall_sentiment_label') or ''}",
        f"overall_reason: {doc.get('overall_reason') or ''}",
        f"like_count: {doc.get('like_count') or 0}",
        f"media_type: {doc.get('media_type') or ''}",
        f"created_at: {doc.get('created_at') or ''}",
    ]
    return " | ".join(parts)


def _ensure_doc_embeddings(db: Session, docs: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
    if not docs:
        return {}

    post_ids = [int(d.get("post_id")) for d in docs if d.get("post_id") is not None]
    rows = (
        db.query(RagDocumentIndex)
        .filter(RagDocumentIndex.post_id.in_(post_ids))
        .all()
        if post_ids
        else []
    )
    row_map = {(int(r.post_id), int(r.chunk_index)): r for r in rows}

    embedding_by_post: Dict[int, List[Dict[str, Any]]] = {}
    need_embed_chunks: List[Dict[str, Any]] = []

    for doc in docs:
        post_id = int(doc.get("post_id"))
        text = _build_doc_text(doc)
        chunks = _chunk_text(text)
        if not chunks:
            chunks = [text]  # fallback to full text if no chunks

        embedding_by_post[post_id] = []

        for idx, chunk in enumerate(chunks):
            content_hash = _content_hash(chunk)
            row = row_map.get((post_id, idx))

            if (
                row
                and str(getattr(row, "content_hash", "")) == content_hash
                and str(getattr(row, "embedding_model", "")) == RAG_EMBEDDING_MODEL
                and getattr(row, "embedding_json", None)
            ):
                try:
                    embedding = json.loads(row.embedding_json)
                    embedding_by_post[post_id].append({
                        "chunk_index": idx,
                        "chunk_text": chunk,
                        "embedding": embedding,
                        "score": 0.0
                    })
                    continue
                except Exception:
                    pass

            need_embed_chunks.append({
                "post_id": post_id,
                "chunk_index": idx,
                "chunk_text": chunk,
                "content_hash": content_hash,
                "row": row
            })

    if need_embed_chunks:
        vectors = _embed_texts([str(d.get("chunk_text") or "") for d in need_embed_chunks])
        for doc, vec in zip(need_embed_chunks, vectors):
            post_id = doc["post_id"]
            idx = doc["chunk_index"]
            row = doc["row"]
            if not row:
                row = RagDocumentIndex(post_id=post_id, chunk_index=idx)
                row_map[(post_id, idx)] = row

            row.content_hash = str(doc.get("content_hash") or _content_hash(doc["chunk_text"]))
            row.chunk_text = doc["chunk_text"]
            row.embedding_model = RAG_EMBEDDING_MODEL
            row.embedding_json = json.dumps(vec, ensure_ascii=False)
            db.add(row)

            embedding_by_post[post_id].append({
                "chunk_index": idx,
                "chunk_text": doc["chunk_text"],
                "embedding": vec,
                "score": 0.0
            })

        try:
            db.commit()
        except Exception:
            db.rollback()
            logging.warning("Cannot persist rag document embeddings", exc_info=True)

    return embedding_by_post


def _retrieve_admin_rag_docs(question: str, docs: List[Dict[str, Any]], db: Session, top_k: int = 8) -> List[Dict[str, Any]]:
    if not docs:
        return []

    query_vector = _embed_texts([question])[0]
    embedding_by_post = _ensure_doc_embeddings(db=db, docs=docs)
    recency_scores = _compute_doc_recency_scores(docs)

    all_chunks: List[Dict[str, Any]] = []
    for doc in docs:
        post_id = int(doc.get("post_id") or 0)
        chunks = embedding_by_post.get(post_id, [])
        for chunk in chunks:
            chunk["post_id"] = post_id
            chunk["doc"] = doc
            all_chunks.append(chunk)

    # Initial retrieval with cosine similarity, plus soft recency bias.
    for chunk in all_chunks:
        semantic_score = _cosine_similarity(query_vector, chunk["embedding"])
        recency_score = recency_scores.get(chunk["post_id"], 0.0)
        chunk["score"] = (1.0 - RAG_RECENCY_WEIGHT) * semantic_score + RAG_RECENCY_WEIGHT * recency_score

    all_chunks.sort(key=lambda x: x["score"], reverse=True)
    top_chunks = all_chunks[:max(10, top_k * 2)]  # Get more for reranking

    # Rerank top chunks
    reranked_chunks = _rerank_chunks(question, top_chunks, top_k=top_k)

    # Group by post and select best chunk per post
    post_best_chunk: Dict[int, Dict[str, Any]] = {}
    for chunk in reranked_chunks:
        post_id = chunk["post_id"]
        recency_score = recency_scores.get(post_id, 0.0)
        normalized_chunk_score = max(float(chunk.get("_normalized_score") or 0.0), 0.0)
        chunk["_combined_score"] = (1.0 - RAG_RECENCY_WEIGHT) * normalized_chunk_score + RAG_RECENCY_WEIGHT * recency_score
        if post_id not in post_best_chunk or chunk["_combined_score"] > post_best_chunk[post_id].get("_combined_score", 0.0):
            post_best_chunk[post_id] = chunk

    selected_docs: List[Dict[str, Any]] = []
    for post_id, chunk in post_best_chunk.items():
        doc = chunk["doc"]
        doc["_retrieval_score"] = chunk.get("_combined_score", 0.0)
        doc["_retrieved_chunks"] = [chunk.get("chunk_text")]
        selected_docs.append(doc)

    selected_docs.sort(key=lambda d: d.get("_retrieval_score", 0.0), reverse=True)
    return selected_docs


def _build_admin_rag_documents(db: Session, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    q = (
        db.query(Post)
        .options(joinedload(Post.author))
        .order_by(Post.id.desc())
    )
    if isinstance(limit, int) and limit > 0:
        q = q.limit(limit)

    posts = q.all()
    post_ids = [int(p.id) for p in posts]
    overall_rows = (
        db.query(OverallAnalysisCache)
        .filter(OverallAnalysisCache.post_id.in_(post_ids))
        .all()
        if post_ids
        else []
    )
    sentiment_rows = (
        db.query(PostSentimentCache)
        .filter(PostSentimentCache.post_id.in_(post_ids))
        .all()
        if post_ids
        else []
    )

    overall_map: Dict[int, Dict[str, Any]] = {}
    for row in overall_rows:
        try:
            overall_map[int(row.post_id)] = json.loads(row.payload or "{}")
        except Exception:
            overall_map[int(row.post_id)] = {}

    sentiment_map: Dict[int, Dict[str, Any]] = {}
    for row in sentiment_rows:
        sentiment_map[int(row.post_id)] = {
            "label": _normalize_to_three_label(getattr(row, "sentiment_label", None)),
            "score": float(getattr(row, "sentiment_score", 0.0) or 0.0),
        }

    docs: List[Dict[str, Any]] = []
    for p in posts:
        payload = overall_map.get(int(p.id), {})
        caption = _normalize_post_text(getattr(p, "content", None))
        overall_label = str(payload.get("overall_sentiment_label") or "").upper()
        if overall_label not in {"POSITIVE", "NEUTRAL", "NEGATIVE", "POS", "NEU", "NEG"}:
            fallback = sentiment_map.get(int(p.id), {})
            overall_label = str(fallback.get("label") or "").upper()

        # Keep display labels consistent in admin RAG payload.
        if overall_label == "POS":
            overall_label = "POSITIVE"
        elif overall_label == "NEU":
            overall_label = "NEUTRAL"
        elif overall_label == "NEG":
            overall_label = "NEGATIVE"
        overall_reason = _normalize_post_text(payload.get("overall_reason"))
        media_desc = _normalize_post_text((payload.get("media_analysis") or {}).get("description"))
        media_url = _normalize_post_text(getattr(p, "media_url", None))
        media_type = _normalize_post_text(getattr(p, "media_type", None))
        has_media = bool(media_url) or bool(media_type and media_type.lower() not in {"null", "none", "n/a"})
        caption_only = bool(caption) and not has_media
        author_name = _normalize_post_text(getattr(p.author, "display_name", None) if p.author else None)
        author_id = int(p.author_id) if p.author_id else None
        author_dob = getattr(p.author, "date_of_birth", None) if p.author else None
        author_dob_text = author_dob.isoformat() if author_dob else ""
        author_created_at = getattr(p.author, "created_at", None) if p.author else None
        author_created_at_text = author_created_at.isoformat() if author_created_at else ""
        author_email = _normalize_post_text(getattr(p.author, "email", None) if p.author else None)
        created_at = getattr(p, "created_at", None)
        created_at_text = created_at.isoformat() if created_at else ""
        like_count = int(getattr(p, "like_count", 0) or 0)

        merged = " | ".join(
            part
            for part in [
                f"post_id:{p.id}",
                f"author_id:{author_id}" if author_id else "",
                f"author:{author_name}" if author_name else "",
                f"author_email:{author_email}" if author_email else "",
                f"author_dob:{author_dob_text}" if author_dob_text else "",
                f"author_account_created:{author_created_at_text}" if author_created_at_text else "",
                f"post_likes:{like_count}",
                f"caption:{caption}" if caption else "caption:(none)",
                f"caption_only:{str(caption_only).lower()}",
                f"has_media:{str(has_media).lower()}",
                f"media_type:{media_type}" if media_type else "media_type:none",
                f"media_description:{media_desc}" if media_desc else "",
                f"overall_sentiment:{overall_label}" if overall_label else "",
                f"overall_reason:{overall_reason}" if overall_reason else "",
                f"created_at:{created_at_text}" if created_at_text else "",
            ]
            if part
        )

        docs.append(
            {
                "post_id": int(p.id),
                "author_id": author_id,
                "author": author_name,
                "author_email": author_email,
                "author_dob": author_dob_text or None,
                "author_created_at": author_created_at_text or None,
                "created_at": created_at_text,
                "like_count": like_count,
                "caption": caption,
                "media_url": media_url,
                "media_type": media_type,
                "has_media": has_media,
                "caption_only": caption_only,
                "overall_sentiment_label": overall_label or None,
                "overall_reason": overall_reason or None,
                "content": merged,
            }
        )

    return docs


def _count_posts_by_author_exact(db: Session, author_name: str) -> int:
    target_norm = _normalize_search_text(author_name)
    if not target_norm:
                return 0
    return int(
        db.query(func.count(Post.id))
        .join(Post.author)
        .filter(func.lower(User.display_name) == target_norm)
        .scalar()
        or 0
    )


def _build_database_facts(db: Session, docs: List[Dict[str, Any]], question: str) -> Dict[str, Any]:
    total_posts = int(db.query(func.count(Post.id)).scalar() or 0)
    total_users = int(db.query(func.count(User.id)).scalar() or 0)

    media_filter = or_(
        and_(Post.media_url.isnot(None), func.length(func.trim(Post.media_url)) > 0),
        and_(
            Post.media_type.isnot(None),
            func.lower(func.trim(Post.media_type)).notin_(["", "none", "null", "n/a"]),
        ),
    )
    posts_with_media = int(db.query(func.count(Post.id)).filter(media_filter).scalar() or 0)
    posts_without_media = max(0, total_posts - posts_with_media)

    sentiment_counts = {"POSITIVE": 0, "NEUTRAL": 0, "NEGATIVE": 0, "UNKNOWN": 0}
    for d in docs:
        label = str(d.get("overall_sentiment_label") or "").upper()
        if label not in sentiment_counts:
            label = "UNKNOWN"
        sentiment_counts[label] += 1

    top_authors_rows = (
        db.query(User.display_name, func.count(Post.id).label("post_count"))
        .join(Post, Post.author_id == User.id)
        .group_by(User.id, User.display_name)
        .order_by(func.count(Post.id).desc(), User.id.desc())
        .limit(5)
        .all()
    )
    top_authors = [
        {
            "display_name": _normalize_post_text(display_name) or "(unknown)",
            "post_count": int(post_count or 0),
        }
        for display_name, post_count in top_authors_rows
    ]

    latest_rows = (
        db.query(Post)
        .options(joinedload(Post.author))
        .order_by(Post.created_at.desc().nullslast(), Post.id.desc())
        .limit(5)
        .all()
    )
    latest_posts = [
        {
            "post_id": int(p.id),
            "created_at": getattr(p, "created_at", None).isoformat() if getattr(p, "created_at", None) else None,
            "author": _normalize_post_text(getattr(p.author, "display_name", None) if p.author else None) or None,
            "like_count": int(getattr(p, "like_count", 0) or 0),
            "has_media": bool(_normalize_post_text(getattr(p, "media_url", None))),
        }
        for p in latest_rows
    ]

    mentioned_post_ids = sorted(
        {
            int(x)
            for x in re.findall(
                r"\b(?:post[_\s-]*id|bài)\s*#?\s*(\d+)\b",
                question or "",
                flags=re.IGNORECASE,
            )
        }
    )
    mentioned_docs = [d for d in docs if int(d.get("post_id") or 0) in set(mentioned_post_ids)]

    requested_sentiment = _extract_sentiment_from_query(question)
    sentiment_count_in_corpus = None
    if requested_sentiment:
        sentiment_count_in_corpus = sum(
            1
            for d in docs
            if str(d.get("overall_sentiment_label") or "").upper() == requested_sentiment
        )

    target_author = _find_target_author(question, docs)
    target_author_exact_post_count = (
        _count_posts_by_author_exact(db, target_author)
        if target_author
        else None
    )

    target_author_docs: List[Dict[str, Any]] = []
    target_author_sentiment_counts: Dict[str, int] = {
        "POSITIVE": 0,
        "NEUTRAL": 0,
        "NEGATIVE": 0,
        "UNKNOWN": 0,
    }
    target_author_post_ids: List[int] = []
    if target_author:
        target_norm = _normalize_search_text(target_author)
        target_author_docs = [
            d for d in docs
            if _normalize_search_text(str(d.get("author") or "")) == target_norm
        ]
        for d in target_author_docs:
            label = str(d.get("overall_sentiment_label") or "").upper()
            if label not in target_author_sentiment_counts:
                label = "UNKNOWN"
            target_author_sentiment_counts[label] += 1

        target_author_docs.sort(
            key=lambda x: (str(x.get("created_at") or ""), int(x.get("post_id") or 0)),
            reverse=True,
        )
        target_author_post_ids = [int(d.get("post_id") or 0) for d in target_author_docs if int(d.get("post_id") or 0) > 0]

    return {
        "total_posts": total_posts,
        "total_users": total_users,
        "posts_with_media": posts_with_media,
        "posts_without_media": posts_without_media,
        "sentiment_counts_from_corpus": sentiment_counts,
        "rag_corpus_size": len(docs),
        "rag_document_limit": int(RAG_DOCUMENT_LIMIT),
        "corpus_limited": bool(RAG_DOCUMENT_LIMIT > 0),
        "top_authors": top_authors,
        "latest_posts": latest_posts,
        "question_intent": {
            "requested_sentiment": requested_sentiment,
            "requested_sentiment_count_in_corpus": sentiment_count_in_corpus,
            "target_author": target_author,
            "target_author_exact_post_count": target_author_exact_post_count,
            "target_author_corpus_post_count": len(target_author_docs),
            "target_author_sentiment_counts": target_author_sentiment_counts if target_author else None,
            "target_author_recent_post_ids": target_author_post_ids[:20],
            "mentioned_post_ids": mentioned_post_ids,
            "mentioned_posts_found": [
                {
                    "post_id": d.get("post_id"),
                    "author": d.get("author"),
                    "overall_sentiment_label": d.get("overall_sentiment_label"),
                    "like_count": d.get("like_count"),
                    "created_at": d.get("created_at"),
                }
                for d in mentioned_docs[:10]
            ],
        },
    }


@router.post("/rag/chat", dependencies=[Depends(admin_required)])
def admin_rag_chat(payload: Dict[str, Any], db: Session = Depends(get_db)):
    question = _normalize_question((payload or {}).get("question"))
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    history = (payload or {}).get("history") or []
    if not isinstance(history, list):
        history = []
    clean_history: List[Dict[str, str]] = []
    for item in history[-6:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = _normalize_post_text(item.get("text"))
        if role not in {"user", "assistant"} or not text:
            continue
        clean_history.append({"role": role, "text": text[:800]})
    history = clean_history

    # Admin assistant must have full visibility of system data.
    # Always load full corpus for admin chat.
    docs = _build_admin_rag_documents(db=db, limit=None)
    if not docs:
        return {
            "answer": "Hiện chưa có dữ liệu bài viết để phân tích. Vui lòng thử lại sau khi có thêm bài viết.",
            "citations": [],
            "retrieved_count": 0,
            "retrieval_mode": "empty_corpus",
            "embedding_model": None,
            "answer_type": "metric",
            "show_citations": False,
        }

    database_facts = _build_database_facts(db=db, docs=docs, question=question)
    question_intent = database_facts.get("question_intent", {}) if isinstance(database_facts, dict) else {}
    mentioned_post_ids = set(question_intent.get("mentioned_post_ids") or [])
    target_author = str(question_intent.get("target_author") or "").strip()

    # Standard RAG: retrieve only the most relevant documents for this question.
    context_pool = _retrieve_admin_rag_docs(
        question=question,
        docs=docs,
        db=db,
        top_k=max(6, RAG_RETRIEVAL_TOP_K),
    )

    # For social media system: always seed recent posts to ensure real-time awareness.
    # Add top 10 most recent posts to context pool, regardless of retrieval.
    recent_docs = sorted(docs, key=lambda d: str(d.get("created_at") or ""), reverse=True)[:10]
    seed_docs: List[Dict[str, Any]] = []
    if mentioned_post_ids:
        seed_docs.extend([d for d in docs if int(d.get("post_id") or 0) in mentioned_post_ids])
    if target_author:
        target_norm = _normalize_search_text(target_author)
        seed_docs.extend([
            d for d in docs
            if _normalize_search_text(str(d.get("author") or "")) == target_norm
        ])
    # Always include recent posts
    seed_docs.extend(recent_docs)

    seen_post_ids: set[int] = set()
    for d in seed_docs + context_pool:
        post_id = int(d.get("post_id") or 0)
        if post_id <= 0 or post_id in seen_post_ids:
            continue
        seen_post_ids.add(post_id)
        context_pool.append(d)

    context_for_prompt = [
        {
            "post_id": d.get("post_id"),
            "author_id": d.get("author_id"),
            "author": d.get("author"),
            "author_email": d.get("author_email"),
            "author_dob": d.get("author_dob"),
            "author_created_at": d.get("author_created_at"),
            "created_at": d.get("created_at"),
            "like_count": d.get("like_count"),
            "overall_sentiment_label": d.get("overall_sentiment_label"),
            "overall_reason": d.get("overall_reason"),
            "caption": d.get("caption"),
            "media_type": d.get("media_type"),
            "media_url": d.get("media_url"),
            "retrieved_chunks": d.get("_retrieved_chunks", []),
        }
        for d in sorted(context_pool, key=lambda d: str(d.get("created_at") or ""), reverse=True)  # Sort by recency
    ]

    system_prompt = (
        "Bạn là trợ lý dữ liệu cho quản trị viên và PHẢI bám sát dữ liệu được cung cấp.\n"
        "Quy tắc bắt buộc:\n"
        "- Chỉ dùng số liệu trong database_facts và context_documents.\n"
        "- Không suy đoán, không tự bịa số.\n"
        "- Nếu thiếu dữ liệu thì nói rõ: Chưa đủ dữ liệu.\n"
        "- Không nhắc tên kỹ thuật như database_facts hoặc context_documents trong câu trả lời.\n"
        "- Không dùng cụm 'không có post_id liên quan'.\n"
        "- Trả lời lịch sự, rõ ràng, mạch lạc và tự nhiên bằng tiếng Việt.\n"
        "- Có thể trả lời ngắn hoặc dài tùy độ phức tạp câu hỏi.\n"
        "- Nếu phù hợp có thể dùng đoạn văn hoặc bullet để dễ đọc.\n"
        "- Sử dụng retrieved_chunks trong context_documents để trích dẫn chính xác nội dung liên quan.\n"
        "- Ưu tiên thông tin từ bài viết gần đây nhất khi có thể, đặc biệt cho câu hỏi về tình hình hiện tại hoặc xu hướng."
    )

    user_prompt = {
        "question": question,
        "history": history,
        "database_facts": database_facts,
        "context_documents": context_for_prompt,
        "instructions": [
            "Ưu tiên số liệu thực tế và con số cụ thể.",
            "Không nhắc nguồn kỹ thuật nội bộ.",
            "Giọng văn lịch sự, dễ hiểu, diễn đạt rõ ý.",
            "Sử dụng retrieved_chunks để trích dẫn nội dung chính xác từ bài viết liên quan.",
            "Nếu có Post liên quan thì nêu Post #id.",
        ],
    }

    try:
        answer = _groq_chat_completion(
            model=GROQ_FUSION_MODEL,
            max_tokens=450,
            temperature=0.1,
            api_key=GROQ_API_KEY_RAG,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
        )
    except Exception as e:
        code = str(e)
        raise HTTPException(status_code=503, detail=f"RAG model unavailable: {code[:160]}")

    answer = _clean_rag_answer_text(answer)
    retrieval_mode = "db_context_vector_retrieval"
    answer_type = "rag_reasoning_chunked_vector_retrieval"

    show_citations = True
    citations: List[Dict[str, Any]] = [
        {
            "post_id": d.get("post_id"),
            "author": d.get("author"),
            "created_at": d.get("created_at"),
            "chunks": d.get("_retrieved_chunks", []),
            "score": d.get("_retrieval_score", 0.0),
        }
        for d in context_pool
    ]

    return {
        "answer": answer,
        "citations": citations,
        "show_citations": show_citations,
        "retrieved_count": len(context_pool),
        "retrieval_mode": retrieval_mode,
        "embedding_model": RAG_EMBEDDING_MODEL,
        "answer_type": answer_type,
    }
