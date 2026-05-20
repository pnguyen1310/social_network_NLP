# backend/routes/admin.py
from __future__ import annotations
from typing import Any, Dict, List, Optional
import base64
import hashlib
import logging
import mimetypes
import os
import json
import re
from functools import lru_cache
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, literal_column, or_
from sqlalchemy.exc import ProgrammingError, OperationalError, IntegrityError
from sqlalchemy.orm import Session, joinedload

from db import get_db, SessionLocal
from models.user import User
from models.post import Post
from models.comment import Comment
from models.friend import FriendRequest, Friendship
from models.notification import Notification
from models.report import Report
from models.image_analysis import ImageAnalysisCache
from models.post_sentiment_cache import PostSentimentCache
from models.overall_analysis_cache import OverallAnalysisCache
from models.rag_document_index import RagDocumentIndex
from models.toxic_language_cache import ToxicLanguageCache
from services.notify import send_notification
from routes.auth import current_user  # đã có sẵn

router = APIRouter(prefix="/admin", tags=["admin"])

MODEL_DIR = Path(__file__).resolve().parents[2] / "ViBert"
UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
GROQ_API_URL = os.getenv("GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_VISION_MODEL = (
    os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct").strip()
    or "meta-llama/llama-4-scout-17b-16e-instruct"
)
GROQ_FUSION_MODEL = (
    os.getenv("GROQ_FUSION_MODEL", GROQ_VISION_MODEL).strip() or GROQ_VISION_MODEL
)
GROQ_TOXIC_MODEL = (
    os.getenv("GROQ_TOXIC_MODEL", GROQ_FUSION_MODEL).strip() or GROQ_FUSION_MODEL
)
SUPER_ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@admin.com").strip().lower()
SENTIMENT_MODEL_REF = os.getenv("SENTIMENT_MODEL_REF", str(MODEL_DIR)).strip() or str(MODEL_DIR)
OVERALL_ANALYSIS_CACHE_VERSION = os.getenv("OVERALL_ANALYSIS_CACHE_VERSION", "v1").strip() or "v1"


@lru_cache(maxsize=1)
def _get_sentiment_pipeline():
    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except Exception as e:
        raise RuntimeError("transformers_not_installed") from e

    if not MODEL_DIR.exists():
        raise RuntimeError("model_dir_not_found")

    # Load model/tokenizer theo đúng config trong model dir
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), use_fast=False)

    raw_id2label = getattr(model.config, "id2label", {}) or {}
    id2label: Dict[int, str] = {}
    for k, v in raw_id2label.items():
        try:
            id2label[int(k)] = str(v)
        except Exception:
            continue

    # Đưa model vào eval để suy luận ổn định hơn.
    model.eval()
    return {"model": model, "tokenizer": tokenizer, "id2label": id2label}


def _predict_sentiments(texts: List[str]) -> List[Dict[str, Any]]:
    if not texts:
        return []

    pipe = _get_sentiment_pipeline()

    try:
        import torch
    except Exception as e:
        raise RuntimeError("torch_not_installed") from e

    model = pipe["model"]
    tokenizer = pipe["tokenizer"]
    id2label = pipe.get("id2label") or {}

    inputs = tokenizer(texts, truncation=True, max_length=256, return_tensors="pt", padding=True)
    device = next(model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    logits = outputs.logits
    predictions = torch.softmax(logits, dim=-1)

    results: List[Dict[str, Any]] = []
    for pred_idx in predictions:
        label_id = int(torch.argmax(pred_idx).item())
        score = float(pred_idx[label_id].item())
        label = id2label.get(label_id, str(label_id))
        results.append({"label": label, "score": score, "label_id": label_id})

    return results


def _resolve_media_file_path(media_url: str | None) -> Path | None:
    if not media_url or not media_url.startswith("/uploads/"):
        return None

    relative = media_url.split("/uploads/", 1)[-1].strip("/\\")
    if not relative:
        return None

    candidate = (UPLOAD_DIR / relative).resolve()
    upload_root = UPLOAD_DIR.resolve()
    if candidate != upload_root and upload_root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


def _groq_error_message(code: str) -> str:
    if code == "groq_api_key_missing":
        return "Chua cau hinh GROQ_API_KEY"
    if code == "opencv_not_installed":
        return "Chua cai dat opencv-python-headless de trich frame video"
    if code == "video_open_failed":
        return "Khong mo duoc tep video"
    if code == "video_frame_extract_failed":
        return "Khong trich duoc frame tu video"
    if code.startswith("groq_http_error:"):
        return f"Groq API tra ve loi HTTP ({code.split(':', 2)[1]})"
    if code.startswith("groq_request_failed:"):
        return "Khong goi duoc Groq API"
    if code == "groq_empty_response":
        return "Groq API khong tra ve noi dung mo ta"
    return "Khong mo ta duoc anh bang Groq"


def _sanitize_groq_text(text: str) -> str:
    cleaned = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"\*\*(.*?)\*\*", r"\1", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"__(.*?)__", r"\1", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"\*(.*?)\*", r"\1", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"_(.*?)_", r"\1", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", cleaned)
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*[-+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = " ".join(cleaned.split())
    return cleaned.strip()


def _parse_groq_json_payload(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        raise RuntimeError("groq_empty_json_payload")

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    # Try to recover JSON object when model wraps output with extra prose or fences.
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        candidate = match.group(0).strip()
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    raise RuntimeError("groq_non_json_payload")


def _toxic_severity_from_score(score: float) -> str:
    if score >= 0.85:
        return "high"
    if score >= 0.55:
        return "medium"
    return "low"


VI_PROFANITY_KEYWORDS = [
    # Common profanity and abbreviations
    "địt",
    "dit",
    "địt mẹ",
    "dit me",
    "đụ",
    "du me",
    "đm",
    "dm",
    "dmm",
    "dmme",
    "dm m",
    "đmm",
    "đm m",
    "địt cụ",
    "dit cu",
    "đéo",
    "deo",
    "đéo mẹ",
    "deo me",
    "đếch",
    "dech",
    "lồn",
    "đầu buồi",
    "dau buoi",
    "buồi",
    "cặc",
    "cặc lồn",
    "cac lon",
    "vãi",
    "vãi lồn",
    "vai lon",
    "vcl",
    "vl",
    "clm",
    "ccm",
    "cmn",
    "cc",
    "cút mẹ",
    "cut me",

    # Personal attacks and insulting phrases
    "ngu",
    "ngu vl",
    "ngu vcl",
    "ngu như chó",
    "ngu nhu cho",
    "đần",
    "đần độn",
    "dan don",
    "óc lợn",
    "oc lon",
    "óc chó",
    "oc cho",
    "mất dạy",
    "mat day",
    "vô học",
    "vo hoc",
    "thằng chó",
    "thang cho",
    "con chó",
    "con cho",
    "chó chết",
    "cho chet",
    "đồ chó",
    "do cho",
    "súc vật",
    "suc vat",
    "rác rưởi",
    "rac ruoi",
    "não tàn",
    "nao tan",
    "vô dụng",
    "vo dung",

    # Multi-word abusive forms
    "khốn nạn",
    "khon nan",
    "câm mồm",
    "cam mom",
    "im mẹ mày",
    "im me may",
    "mẹ mày",
    "me may",
    "bố mày",
    "đồ ngu",
    "do ngu",
    "đồ điên",
    "do dien",
    "xàm lồn",
    "xam lon",
    "ăn nói như c",
    "an noi nhu c",
]


def _extract_vietnamese_profanity_terms(text: str) -> List[str]:
    q = _normalize_post_text(text).lower()
    if not q:
        return []

    hits: List[str] = []
    for keyword in VI_PROFANITY_KEYWORDS:
        pattern = rf"(?<!\w){re.escape(keyword)}(?!\w)"
        if re.search(pattern, q, flags=re.IGNORECASE):
            hits.append(keyword)
    return list(dict.fromkeys(hits))


def _contains_vietnamese_profanity(text: str) -> bool:
    return bool(_extract_vietnamese_profanity_terms(text))


def _analyze_toxic_vietnamese_text_with_groq(text: str) -> Dict[str, Any]:
    normalized_text = _normalize_post_text(text)
    if not normalized_text:
        return {
            "has_text": False,
            "is_toxic": False,
            "toxic_score": 0.0,
            "severity": "low",
            "reason": "No text content",
            "categories": [],
            "matched_terms": [],
            "model": GROQ_TOXIC_MODEL,
            "source": "groq",
            "error": None,
            "error_code": None,
        }

    prompt = {
        "task": "Detect offensive/toxic Vietnamese language in social post text",
        "language": "vi",
        "text": normalized_text,
        "output_format": {
            "is_toxic": "boolean",
            "toxic_score": "number 0..1",
            "reason": "short Vietnamese explanation",
            "categories": [
                "insult",
                "hate",
                "threat",
                "harassment",
                "profanity",
                "sexual_harassment",
                "other",
            ],
        },
        "rules": [
            "Return valid JSON only.",
            "Use strict value for is_toxic.",
            "If text is neutral, set toxic_score low and categories empty.",
        ],
    }

    try:
        raw = _groq_chat_completion(
            model=GROQ_TOXIC_MODEL,
            max_tokens=180,
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Vietnamese content safety classifier for admin moderation. "
                        "You must output strict JSON with toxicity decision."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt, ensure_ascii=True),
                },
            ],
        )
        parsed = _parse_groq_json_payload(raw)
    except Exception as e:
        code = str(e)[:220]
        return {
            "has_text": True,
            "is_toxic": None,
            "toxic_score": None,
            "severity": None,
            "reason": "Groq toxic analysis unavailable",
            "categories": [],
            "matched_terms": _extract_vietnamese_profanity_terms(normalized_text),
            "model": GROQ_TOXIC_MODEL,
            "source": "groq",
            "error": "Groq toxic analysis failed",
            "error_code": code,
        }

    is_toxic = parsed.get("is_toxic")
    if isinstance(is_toxic, str):
        is_toxic = is_toxic.strip().lower() in {"true", "1", "yes"}
    elif not isinstance(is_toxic, bool):
        is_toxic = False

    score = parsed.get("toxic_score")
    try:
        score = float(score)
    except Exception:
        score = 0.0
    score = max(0.0, min(1.0, score))

    categories = parsed.get("categories")
    if not isinstance(categories, list):
        categories = []
    categories = [str(c).strip() for c in categories if str(c).strip()][:6]

    reason = str(parsed.get("reason") or "").strip()
    if not reason:
        reason = "Detected by Groq toxic-language classifier" if is_toxic else "Text appears non-toxic"

    matched_terms = _extract_vietnamese_profanity_terms(normalized_text)
    if matched_terms:
        is_toxic = True
        score = max(score, 0.9)
        if "tu ngu xuc pham" not in reason.lower():
            reason = f"{reason}. Phat hien tu ngu xuc pham tieng Viet ro rang.".strip(". ")
        if "profanity" not in categories:
            categories = [*categories, "profanity"]

    return {
        "has_text": True,
        "is_toxic": bool(is_toxic),
        "toxic_score": score,
        "severity": _toxic_severity_from_score(score),
        "reason": reason[:280],
        "categories": categories,
        "matched_terms": matched_terms,
        "model": GROQ_TOXIC_MODEL,
        "source": "groq",
        "error": None,
        "error_code": None,
    }


def _upsert_toxic_language_cache(db: Session, post_id: int, content: str, analysis: Dict[str, Any]) -> None:
    normalized_text = _normalize_post_text(content)
    content_hash = hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()

    row = db.query(ToxicLanguageCache).filter(ToxicLanguageCache.post_id == post_id).first()
    if not row:
        row = ToxicLanguageCache(post_id=post_id)

    row.content_hash = content_hash
    row.is_toxic = analysis.get("is_toxic") if isinstance(analysis.get("is_toxic"), bool) else None

    score = analysis.get("toxic_score")
    row.toxic_score = float(score) if isinstance(score, (int, float)) else None
    row.severity = str(analysis.get("severity") or "").strip() or None
    row.reason = str(analysis.get("reason") or "").strip() or None

    categories = analysis.get("categories") if isinstance(analysis.get("categories"), list) else []
    matched_terms = analysis.get("matched_terms") if isinstance(analysis.get("matched_terms"), list) else []
    row.categories_json = json.dumps(categories, ensure_ascii=False)
    row.matched_terms_json = json.dumps(matched_terms, ensure_ascii=False)

    row.model = str(analysis.get("model") or "").strip() or None
    row.source = str(analysis.get("source") or "").strip() or "groq"
    row.error = str(analysis.get("error") or "").strip() or None
    row.error_code = str(analysis.get("error_code") or "").strip() or None

    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logging.warning("Cannot persist toxic language cache for post_id=%s", post_id, exc_info=True)


def _groq_chat_completion(
    model: str,
    messages: List[Dict[str, Any]],
    max_tokens: int = 180,
    temperature: float = 0.2,
    api_key: Optional[str] = None,
) -> str:
    token = (api_key or GROQ_API_KEY or "").strip()
    if not token:
        raise RuntimeError("groq_api_key_missing")

    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    req = urlrequest.Request(
        GROQ_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        },
    )

    try:
        with urlrequest.urlopen(req, timeout=35) as resp:
            raw = resp.read()
    except urlerror.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="ignore")
        except Exception:
            detail = ""
        raise RuntimeError(f"groq_http_error:{e.code}:{detail[:250]}") from e
    except Exception as e:
        raise RuntimeError(f"groq_request_failed:{type(e).__name__}") from e

    try:
        data = json.loads(raw.decode("utf-8", errors="ignore"))
        text = (
            ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
            if isinstance(data, dict)
            else None
        )
        text = _sanitize_groq_text(str(text or ""))
        if not text:
            raise RuntimeError("groq_empty_response")
        return text
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"groq_request_failed:{type(e).__name__}") from e


def _image_path_to_data_url(image_path: Path) -> str:
    mime = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    image_b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{image_b64}"


def _describe_image_with_groq(image_path: Path, post_content: str | None = None) -> str:
    context_text = (post_content or "").strip()

    return _groq_chat_completion(
        model=GROQ_VISION_MODEL,
        max_tokens=180,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": "Ban la tro ly mo ta hinh anh cho he thong quan tri. Tra ve 1-2 cau tieng Viet ngan gon, trung tinh. Khong dung markdown, khong dung ky tu ** hoac dau gach dau dong. Khong can dua ra thong tin class, bbox, confidence.",
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Hay mo ta ngan gon noi dung buc anh va cac doi tuong chinh trong anh.",
                    },
                    *([
                        {
                            "type": "text",
                            "text": f"Ngu canh bai dang (neu co): {context_text[:500]}",
                        }
                    ] if context_text else []),
                    {
                        "type": "image_url",
                        "image_url": {"url": _image_path_to_data_url(image_path)},
                    },
                ],
            },
        ],
    )


def _extract_video_keyframe_data_urls(video_path: Path, max_frames: int = 3) -> List[str]:
    try:
        import cv2  # type: ignore
    except Exception as e:
        raise RuntimeError("opencv_not_installed") from e

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("video_open_failed")

    try:
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if frame_count <= 0:
            raise RuntimeError("video_frame_extract_failed")

        frame_indexes = sorted(
            {
                0,
                max(0, frame_count // 2),
                max(0, frame_count - 1),
            }
        )
        frame_indexes = frame_indexes[:max_frames]

        data_urls: List[str] = []
        for idx in frame_indexes:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue

            height, width = frame.shape[:2]
            max_side = max(height, width)
            if max_side > 960:
                ratio = 960.0 / float(max_side)
                frame = cv2.resize(frame, (int(width * ratio), int(height * ratio)))

            encoded_ok, buf = cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), 75],
            )
            if not encoded_ok:
                continue

            frame_b64 = base64.b64encode(buf.tobytes()).decode("ascii")
            data_urls.append(f"data:image/jpeg;base64,{frame_b64}")

        if not data_urls:
            raise RuntimeError("video_frame_extract_failed")

        return data_urls
    finally:
        cap.release()


def _describe_video_with_groq(video_path: Path, post_content: str | None = None) -> Dict[str, Any]:
    frame_data_urls = _extract_video_keyframe_data_urls(video_path=video_path, max_frames=3)
    context_text = (post_content or "").strip()

    user_content: List[Dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Day la cac keyframe cua mot video. "
                "Hay tom tat ngan gon noi dung video, nhan vat/chu the chinh va hanh dong dang xay ra."
            ),
        }
    ]
    if context_text:
        user_content.append(
            {
                "type": "text",
                "text": f"Ngu canh bai dang (neu co): {context_text[:500]}",
            }
        )

    for frame_url in frame_data_urls:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": frame_url},
            }
        )

    description = _groq_chat_completion(
        model=GROQ_VISION_MODEL,
        max_tokens=220,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": "Ban la tro ly mo ta video cho he thong quan tri. Tra ve 2-3 cau tieng Viet ngan gon, trung tinh. Khong dung markdown.",
            },
            {
                "role": "user",
                "content": user_content,
            },
        ],
    )

    return {
        "description": description,
        "description_mode": "video_keyframes",
        "video_keyframes": len(frame_data_urls),
    }


def _analyze_image_with_groq(image_path: Path, post_content: str | None = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "description": None,
        "description_model": GROQ_VISION_MODEL,
        "description_error": None,
        "description_error_code": None,
        "description_mode": None,
    }

    try:
        payload["description"] = _describe_image_with_groq(image_path=image_path, post_content=post_content)
        payload["description_mode"] = "vision"
    except RuntimeError as e:
        code = str(e)
        payload["description_error"] = _groq_error_message(code)
        payload["description_error_code"] = code
        payload["description_mode"] = "error"

    return payload


def _analyze_media_with_groq(
    media_path: Path,
    media_type: str | None,
    post_content: str | None = None,
) -> Dict[str, Any]:
    if media_type == "video":
        payload: Dict[str, Any] = {
            "description": None,
            "description_model": GROQ_VISION_MODEL,
            "description_error": None,
            "description_error_code": None,
            "description_mode": None,
            "video_keyframes": 0,
        }
        try:
            video_result = _describe_video_with_groq(video_path=media_path, post_content=post_content)
            payload["description"] = video_result.get("description")
            payload["description_mode"] = video_result.get("description_mode") or "video_keyframes"
            payload["video_keyframes"] = int(video_result.get("video_keyframes") or 0)
        except RuntimeError as e:
            code = str(e)
            payload["description_error"] = _groq_error_message(code)
            payload["description_error_code"] = code
            payload["description_mode"] = "error"
        return payload

    return _analyze_image_with_groq(image_path=media_path, post_content=post_content)


def _normalize_to_three_label(label: str | None) -> str | None:
    key = str(label or "").strip().upper()
    if key in {"POS", "POSITIVE", "ENJOYMENT"}:
        return "POS"
    if key in {"NEU", "NEUTRAL", "OTHER", "SURPRISE"}:
        return "NEU"
    if key in {"NEG", "NEGATIVE", "ANGER", "DISGUST", "FEAR", "SADNESS"}:
        return "NEG"
    return None


def _fallback_fusion_result(
    model_label: str | None,
    model_score: float | None,
    reason: str,
    *,
    source: str = "model_fallback",
    analysis_mode: str = "caption_only",
    warning: str | None = None,
) -> Dict[str, Any]:
    normalized = _normalize_to_three_label(model_label)
    return {
        "final_label": normalized,
        "confidence": float(model_score) if isinstance(model_score, (int, float)) else None,
        "reason": reason,
        "source": source,
        "analysis_mode": analysis_mode,
        "warning": warning,
        "error_code": None,
    }


def _fuse_sentiment_with_groq(
    *,
    model_label: str | None,
    model_score: float | None,
    caption: str | None,
    media_description: str | None,
) -> Dict[str, Any]:
    """
    Hợp nhất cảm xúc cuối cùng dựa trên:
    - Kết quả model local (folder /model)
    - Caption bài viết
    - Mô tả media từ Groq

    Trả về nhãn 3 lớp chuẩn: POS | NEU | NEG.
    """
    caption_text = _normalize_post_text(caption)
    media_text = _normalize_post_text(media_description)
    normalized_model_label = _normalize_to_three_label(model_label)

    # Case A: Bài không có caption -> media-only
    if not caption_text:
        if not media_text:
            return {
                "final_label": "NEU",
                "confidence": 0.35,
                "reason": "No caption and no media description",
                "source": "groq_media_only_default",
                "analysis_mode": "media_only",
                "warning": "Bai khong co caption va khong trich xuat duoc mo ta media, gan tam Trung tinh",
                "error_code": "media_description_missing",
            }

        try:
            raw = _groq_chat_completion(
                model=GROQ_FUSION_MODEL,
                max_tokens=120,
                temperature=0.1,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Ban la bo phan danh gia cam xuc media-only cho he thong admin. "
                            "Du lieu khong co caption. Tra JSON hop le voi final_label thuoc POS/NEU/NEG, confidence 0..1, reason ngan gon."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "media_description": media_text,
                                "output_format": {
                                    "final_label": "POS|NEU|NEG",
                                    "confidence": "0..1",
                                    "reason": "mot cau ngan gon",
                                },
                                "rules": [
                                    "Vi khong co caption, danh gia than trong.",
                                    "Chi tra JSON, khong markdown.",
                                ],
                            },
                            ensure_ascii=True,
                        ),
                    },
                ],
            )
            parsed = _parse_groq_json_payload(raw)
            final_label = _normalize_to_three_label(parsed.get("final_label"))
            if not final_label:
                return {
                    "final_label": "NEU",
                    "confidence": 0.4,
                    "reason": "Media-only Groq returned invalid label",
                    "source": "groq_media_only_default",
                    "analysis_mode": "media_only",
                    "warning": "Bai khong co caption, Groq tra ket qua khong hop le nen gan tam Trung tinh",
                    "error_code": "groq_invalid_label",
                }

            confidence = parsed.get("confidence")
            try:
                confidence = float(confidence)
            except Exception:
                confidence = 0.7

            # Media-only: hạ độ tin cậy để tránh over-confident khi thiếu caption.
            confidence = max(0.0, min(1.0, confidence))
            confidence = min(0.85, confidence * 0.8)

            reason = str(parsed.get("reason") or "")[:280].strip()
            return {
                "final_label": final_label,
                "confidence": confidence,
                "reason": reason or "Media-only fusion by Groq",
                "source": "groq_media_only",
                "analysis_mode": "media_only",
                "warning": "Bai khong co caption, ket qua dua chu yeu vao media",
                "error_code": None,
            }
        except Exception as e:
            err_code = str(e)[:220]
            logging.warning("Media-only Groq fusion failed: %s", err_code, exc_info=True)
            return {
                "final_label": "NEU",
                "confidence": 0.35,
                "reason": "Media-only Groq fusion unavailable",
                "source": "groq_media_only_default",
                "analysis_mode": "media_only",
                "warning": "Bai khong co caption, Groq tam thoi khong kha dung nen gan tam Trung tinh",
                "error_code": err_code,
            }

    if not normalized_model_label:
        return _fallback_fusion_result(
            model_label,
            model_score,
            "Model label is unavailable",
            source="model_unavailable",
            analysis_mode="caption_only",
        )

    # Nếu thiếu dữ liệu text để Groq hợp nhất, dùng thẳng model local.
    if not (caption_text or media_text):
        return _fallback_fusion_result(
            normalized_model_label,
            model_score,
            "No caption/media description, fallback to local model",
            source="model_fallback",
            analysis_mode="caption_only",
        )

    prompt = {
        "instruction": "Hop nhat cam xuc cuoi cung theo 3 nhan POS/NEU/NEG.",
        "local_model_result": {
            "label": normalized_model_label,
            "score": float(model_score) if isinstance(model_score, (int, float)) else None,
        },
        "caption": caption_text or None,
        "media_description": media_text or None,
        "output_format": {
            "final_label": "POS|NEU|NEG",
            "confidence": "0..1",
            "reason": "mot cau giai thich ngan gon",
        },
        "rules": [
            "Uu tien ket qua local model khi thong tin media mo ta mo ho.",
            "Neu caption va media mau thuan, can nhac muc do tin cay local model de ra ket qua cuoi.",
            "Chi tra ve JSON, khong markdown, khong giai thich them.",
        ],
    }

    try:
        raw = _groq_chat_completion(
            model=GROQ_FUSION_MODEL,
            max_tokens=140,
            temperature=0.1,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Ban la bo hop nhat cam xuc cho he thong admin. "
                        "NHIEM VU: dung ket qua local model + ngu canh caption/media de ket luan cuoi cung. "
                        "Bat buoc tra JSON hop le voi final_label thuoc POS/NEU/NEG."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt, ensure_ascii=True),
                },
            ],
        )

        parsed = _parse_groq_json_payload(raw)
        final_label = _normalize_to_three_label(parsed.get("final_label"))
        if not final_label:
            return _fallback_fusion_result(
                normalized_model_label,
                model_score,
                "Groq returned invalid label, fallback to local model",
            )

        confidence = parsed.get("confidence")
        try:
            confidence = float(confidence)
        except Exception:
            confidence = float(model_score) if isinstance(model_score, (int, float)) else None

        if isinstance(confidence, float):
            confidence = max(0.0, min(1.0, confidence))

        reason = str(parsed.get("reason") or "")[:280].strip()

        return {
            "final_label": final_label,
            "confidence": confidence,
            "reason": reason or "Fused by Groq using local model and media description",
            "source": "groq_fusion",
            "analysis_mode": "full_context",
            "warning": None,
            "error_code": None,
        }
    except Exception:
        logging.warning("Groq fusion failed, fallback to local model", exc_info=True)
        return _fallback_fusion_result(
            normalized_model_label,
            model_score,
            "Groq fusion unavailable, fallback to local model",
            source="model_fallback",
            analysis_mode="caption_only",
        )


def _analysis_from_cache(row: ImageAnalysisCache) -> Dict[str, Any]:
    analyzed_at = row.analyzed_at.isoformat() if getattr(row, "analyzed_at", None) else None
    return {
        "description": row.description,
        "description_model": row.description_model,
        "description_error": row.description_error,
        "description_error_code": row.description_error_code,
        "description_mode": row.description_mode,
        "cached": True,
        "cached_at": analyzed_at,
    }


def _get_cached_analysis(db: Session, post_id: int, media_url: str | None) -> Dict[str, Any] | None:
    row = db.query(ImageAnalysisCache).filter(ImageAnalysisCache.post_id == post_id).first()
    if not row:
        return None

    if row.media_url != (media_url or ""):
        return None

    if not row.description:
        return None

    if (row.description_model or "") != GROQ_VISION_MODEL:
        return None

    return _analysis_from_cache(row)


def _save_analysis_cache(db: Session, post_id: int, media_url: str | None, analysis: Dict[str, Any]) -> None:
    # Chỉ cache khi có mô tả thành công để tránh lưu trạng thái lỗi tạm thời.
    if not analysis.get("description"):
        return

    row = db.query(ImageAnalysisCache).filter(ImageAnalysisCache.post_id == post_id).first()
    if not row:
        row = ImageAnalysisCache(post_id=post_id)

    row.media_url = media_url or ""
    row.description = str(analysis.get("description") or "").strip()
    row.description_model = analysis.get("description_model") or GROQ_VISION_MODEL
    row.description_mode = analysis.get("description_mode") or "vision"
    row.description_error = None
    row.description_error_code = None

    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logging.warning("Cannot persist image analysis cache for post_id=%s", post_id, exc_info=True)


# --------- helpers ---------
def admin_required(me: User = Depends(current_user)) -> User:
    if not bool(getattr(me, "is_admin", False)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return me


def _safe_like_count_columns(db: Session):
    """
    Cố gắng suy ra nguồn 'like':
      1) Bảng post_likes(post_id, user_id, created_at)
      2) Cột posts.like_count (int)
      3) Không có -> trả None (FE vẫn chạy, chỉ không có top_liked)
    """
    try:
        # thử xem có bảng post_likes không (Postgres)
        exists = db.execute("SELECT to_regclass('public.post_likes')").scalar()
        if exists:
            return "table"
    except Exception:
        # DB không hỗ trợ to_regclass (SQLite/MySQL) -> bỏ qua
        pass

    # cột trên Post?
    if hasattr(Post, "like_count"):
        return "column"

    return None


def _normalize_post_text(value: str | None) -> str:
    return " ".join(str(value or "").split()).strip()


def _post_text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _file_signature(path: Path | None) -> str:
    if not path:
        return ""
    try:
        stat = path.stat()
        return f"{stat.st_size}:{stat.st_mtime_ns}"
    except Exception:
        return "missing"


def _overall_input_hash(*, caption_text: str, media_url: str | None, media_type: str | None, media_signature: str) -> str:
    payload = {
        "caption": caption_text,
        "media_url": media_url or "",
        "media_type": media_type or "",
        "media_signature": media_signature,
        "sentiment_model_ref": SENTIMENT_MODEL_REF,
        "groq_vision_model": GROQ_VISION_MODEL,
        "groq_fusion_model": GROQ_FUSION_MODEL,
        "cache_version": OVERALL_ANALYSIS_CACHE_VERSION,
    }
    return _post_text_hash(json.dumps(payload, ensure_ascii=True, sort_keys=True))


def _overall_payload_from_cache(row: OverallAnalysisCache) -> Dict[str, Any]:
    analyzed_at = row.analyzed_at.isoformat() if getattr(row, "analyzed_at", None) else None
    payload = json.loads(row.payload or "{}")
    if isinstance(payload, dict):
        payload["overall_cached"] = True
        payload["overall_cached_at"] = analyzed_at
        payload["overall_cache_version"] = row.cache_version
    return payload if isinstance(payload, dict) else {}


def _get_cached_overall_analysis(db: Session, post_id: int, input_hash: str) -> Dict[str, Any] | None:
    row = db.query(OverallAnalysisCache).filter(OverallAnalysisCache.post_id == post_id).first()
    if not row:
        return None
    if row.input_hash != input_hash:
        return None
    try:
        payload = _overall_payload_from_cache(row)
    except Exception:
        return None
    return payload or None


def _save_overall_analysis_cache(db: Session, post_id: int, input_hash: str, payload: Dict[str, Any]) -> None:
    row = db.query(OverallAnalysisCache).filter(OverallAnalysisCache.post_id == post_id).first()
    if not row:
        row = OverallAnalysisCache(post_id=post_id)

    row.input_hash = input_hash
    row.payload = json.dumps(jsonable_encoder(payload), ensure_ascii=False)
    row.cache_version = OVERALL_ANALYSIS_CACHE_VERSION
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logging.warning("Cannot persist overall analysis cache for post_id=%s", post_id, exc_info=True)


def _build_overall_pending_row(
    *,
    p: Post,
    caption_text: str,
    media_url: str | None,
    media_type: str | None,
    input_hash: str,
    media_analysis: Dict[str, Any] | None = None,
    media_error: str | None = None,
) -> Dict[str, Any]:
    media_description = _normalize_post_text((media_analysis or {}).get("description"))
    combined_text = _normalize_post_text(
        f"{caption_text}. {media_description}" if caption_text and media_description else (caption_text or media_description)
    )

    return {
        "id": p.id,
        "content": p.content,
        "created_at": getattr(p, "created_at", None),
        "media_url": media_url,
        "media_type": media_type,
        "author": {
            "id": p.author.id if p.author else None,
            "display_name": p.author.display_name if p.author else None,
            "email": p.author.email if p.author else None,
            "avatar_url": getattr(p.author, "avatar_url", None) if p.author else None,
            "date_of_birth": p.author.date_of_birth.isoformat() if (p.author and getattr(p.author, "date_of_birth", None)) else None,
        },
        "media_analysis": media_analysis,
        "media_analysis_error": media_error,
        "model_input_text": caption_text,
        "combined_text": combined_text,
        "model_sentiment_label": None,
        "model_sentiment_label_id": None,
        "model_sentiment_score": None,
        "overall_sentiment_label": None,
        "overall_sentiment_label_id": None,
        "overall_sentiment_score": None,
        "overall_reason": None,
        "overall_source": None,
        "overall_analysis_mode": None,
        "overall_warning": None,
        "overall_error_code": None,
        "overall_input_hash": input_hash,
        "overall_cached": False,
        "overall_cached_at": None,
        "overall_cache_version": None,
        "overall_analysis_state": "pending",
        "overall_pending_reason": "dang phan tich nen",
        "is_no_caption": not bool(caption_text),
        "is_groq_media_only": False,
    }


def _compute_overall_analysis_row(db: Session, p: Post, refresh: bool = False) -> Dict[str, Any]:
    media_url = getattr(p, "media_url", None)
    media_path = _resolve_media_file_path(media_url)
    caption_text = _normalize_post_text(getattr(p, "content", None))
    media_signature = _file_signature(media_path)
    input_hash = _overall_input_hash(
        caption_text=caption_text,
        media_url=media_url,
        media_type=getattr(p, "media_type", None),
        media_signature=media_signature,
    )

    media_analysis: Dict[str, Any] | None = None
    media_error: str | None = None

    if media_url and not media_path:
        media_error = "Không tìm thấy file media trên server"
    elif media_path:
        try:
            media_analysis = None if refresh else _get_cached_analysis(
                db=db,
                post_id=p.id,
                media_url=p.media_url,
            )
            if not media_analysis:
                media_analysis = _analyze_media_with_groq(
                    media_path=media_path,
                    media_type=getattr(p, "media_type", None),
                    post_content=getattr(p, "content", None),
                )
                media_analysis["cached"] = False
                media_analysis["cached_at"] = None
                _save_analysis_cache(
                    db=db,
                    post_id=p.id,
                    media_url=p.media_url,
                    analysis=media_analysis,
                )
        except Exception:
            logging.error("Overall media analysis failed for post %s", p.id, exc_info=True)
            media_error = "Phân tích media thất bại"

    row = _build_overall_pending_row(
        p=p,
        caption_text=caption_text,
        media_url=media_url,
        media_type=getattr(p, "media_type", None),
        input_hash=input_hash,
        media_analysis=media_analysis,
        media_error=media_error,
    )

    try:
        fusion = _fuse_sentiment_with_groq(
            model_label=row.get("model_sentiment_label"),
            model_score=row.get("model_sentiment_score"),
            caption=row.get("content"),
            media_description=(row.get("media_analysis") or {}).get("description"),
        )
    except Exception as e:
        err_code = f"fusion_row_failed:{type(e).__name__}"
        logging.error("Overall fusion crashed for post_id=%s: %s", row.get("id"), str(e), exc_info=True)
        fusion = {
            "final_label": "NEU",
            "confidence": 0.3,
            "reason": "Fusion failed at row level",
            "source": "fusion_row_fallback",
            "analysis_mode": "media_only" if row.get("is_no_caption") else "caption_only",
            "warning": "Phan tich tong hop loi o 1 bai, da gan tam Trung tinh",
            "error_code": err_code,
        }

    row["overall_sentiment_label"] = fusion.get("final_label")
    row["overall_sentiment_score"] = fusion.get("confidence")
    row["overall_reason"] = fusion.get("reason")
    row["overall_source"] = fusion.get("source")
    row["overall_analysis_mode"] = fusion.get("analysis_mode")
    row["overall_warning"] = fusion.get("warning")
    row["overall_error_code"] = fusion.get("error_code")
    row["is_groq_media_only"] = bool(row.get("is_no_caption")) and str(fusion.get("analysis_mode") or "") == "media_only"

    normalized = _normalize_to_three_label(fusion.get("final_label"))
    if normalized == "NEG":
        row["overall_sentiment_label_id"] = 0
    elif normalized == "POS":
        row["overall_sentiment_label_id"] = 1
    elif normalized == "NEU":
        row["overall_sentiment_label_id"] = 2
    else:
        row["overall_sentiment_label_id"] = None

    row["overall_analysis_state"] = "ready"
    row["overall_pending_reason"] = None
    row["overall_cached"] = False
    row["overall_cached_at"] = None
    row["overall_cache_version"] = OVERALL_ANALYSIS_CACHE_VERSION
    return row


def _warm_overall_analysis_cache(post_ids: List[int], refresh: bool = False) -> None:
    if not post_ids:
        return

    db = SessionLocal()
    try:
        posts = (
            db.query(Post)
            .options(joinedload(Post.author))
            .filter(Post.id.in_(post_ids))
            .all()
        )
        post_map = {int(p.id): p for p in posts}
        for post_id in post_ids:
            p = post_map.get(int(post_id))
            if not p:
                continue
            try:
                row = _compute_overall_analysis_row(db=db, p=p, refresh=refresh)
                _save_overall_analysis_cache(
                    db=db,
                    post_id=int(row.get("id") or p.id),
                    input_hash=str(row.get("overall_input_hash") or ""),
                    payload=row,
                )
            except Exception:
                logging.error("Background overall warmup failed for post %s", post_id, exc_info=True)
    finally:
        db.close()


def _get_sentiment_cache_map(db: Session, post_ids: List[int]) -> Dict[int, PostSentimentCache]:
    if not post_ids:
        return {}
    rows = db.query(PostSentimentCache).filter(PostSentimentCache.post_id.in_(post_ids)).all()
    return {int(r.post_id): r for r in rows}


def _upsert_sentiment_cache(
    db: Session,
    cache_map: Dict[int, PostSentimentCache],
    rows: List[Dict[str, Any]],
) -> None:
    if not rows:
        return

    for row_data in rows:
        post_id = int(row_data["post_id"])
        row = cache_map.get(post_id)
        if not row:
            row = PostSentimentCache(post_id=post_id)
            cache_map[post_id] = row

        row.content_hash = str(row_data["content_hash"])
        row.sentiment_label = str(row_data["label"])
        row.sentiment_label_id = int(row_data["label_id"])
        row.sentiment_score = float(row_data["score"])
        row.model_ref = SENTIMENT_MODEL_REF
        db.add(row)

    try:
        db.commit()
    except Exception:
        db.rollback()
        logging.warning("Cannot persist post sentiment cache", exc_info=True)


# --------- endpoints ---------

@router.get("/stats", dependencies=[Depends(admin_required)])
def admin_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_posts = db.query(func.count(Post.id)).scalar() or 0
    total_comments = db.query(func.count(Comment.id)).scalar() or 0

    # top bình luận
    sub_cmt = (
        db.query(Comment.post_id, func.count(Comment.id).label("cmt_count"))
        .group_by(Comment.post_id)
        .subquery()
    )
    top_commented = (
        db.query(
            Post.id,
            Post.content,
            Post.media_url,
            Post.media_type,
            func.coalesce(sub_cmt.c.cmt_count, 0).label("comments"),
        )
        .outerjoin(sub_cmt, sub_cmt.c.post_id == Post.id)
        .order_by(literal_column("comments").desc(), Post.id.desc())
        .limit(5)
        .all()
    )
    top_commented_out = [
        {
            "id": pid,
            "content": content,
            "media_url": media_url,
            "media_type": media_type,
            "comments": comments or 0,
        }
        for (pid, content, media_url, media_type, comments) in top_commented
    ]

    # top like (nếu có)
    top_liked_out: List[Dict[str, Any]] = []
    like_src = _safe_like_count_columns(db)
    try:
        if like_src == "table":
            rows = db.execute(
                """
                                SELECT p.id, p.content, p.media_url, p.media_type, COALESCE(cnt.c,0) AS likes
                FROM posts p
                LEFT JOIN (
                  SELECT post_id, COUNT(*)::int AS c
                  FROM post_likes
                  GROUP BY post_id
                ) cnt ON cnt.post_id = p.id
                ORDER BY likes DESC, p.id DESC
                LIMIT 5
                """
            ).fetchall()
            top_liked_out = [
                {
                    "id": r[0],
                    "content": r[1],
                    "media_url": r[2],
                    "media_type": r[3],
                    "likes": int(r[4] or 0),
                }
                for r in rows
            ]
        elif like_src == "column":
            rows = (
                db.query(
                    Post.id,
                    Post.content,
                    Post.media_url,
                    Post.media_type,
                    func.coalesce(getattr(Post, "like_count"), 0).label("likes"),
                )
                .order_by(literal_column("likes").desc(), Post.id.desc())
                .limit(5)
                .all()
            )
            top_liked_out = [
                {
                    "id": r[0],
                    "content": r[1],
                    "media_url": r[2],
                    "media_type": r[3],
                    "likes": int(r[4] or 0),
                }
                for r in rows
            ]
    except (ProgrammingError, OperationalError):
        # nếu lỡ sai tên bảng/cột thì thôi, trả rỗng
        top_liked_out = []

    return {
        "totals": {
            "users": total_users,
            "posts": total_posts,
            "comments": total_comments,
        },
        "top_commented": top_commented_out,
        "top_liked": top_liked_out,  # có thể là []
    }


@router.get("/posts", dependencies=[Depends(admin_required)])
def admin_list_posts(
    db: Session = Depends(get_db),
    q: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    query = db.query(Post).options(joinedload(Post.author)).order_by(Post.id.desc())
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(Post.content.ilike(like))
    items = query.limit(limit).offset(offset).all()
    out = []
    for p in items:
        out.append({
            "id": p.id,
            "content": p.content,
            "created_at": getattr(p, "created_at", None),
            "media_url": getattr(p, "media_url", None),
            "media_type": getattr(p, "media_type", None),
            "like_count": int(p.like_count or 0),
            "comment_count": len([c for c in (p.comments or []) if c.content != "__LIKE__"]),
            "author": {
                "id": p.author.id if p.author else None,
                "display_name": p.author.display_name if p.author else None,
                "email": p.author.email if p.author else None,
                "avatar_url": getattr(p.author, "avatar_url", None) if p.author else None,
            },
        })
    return {"items": out, "limit": limit, "offset": offset}


@router.get("/posts/{post_id}", dependencies=[Depends(admin_required)])
def admin_get_post(
    post_id: int,
    analyze_comments: bool = Query(True),
    db: Session = Depends(get_db),
):
    p = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.comments).joinedload(Comment.author))
        .filter(Post.id == post_id)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")

    comments: List[Dict[str, Any]] = []
    real_comments = sorted(
        [c for c in (p.comments or []) if c.content != "__LIKE__"],
        key=lambda item: item.id,
    )

    comment_predictions: List[Dict[str, Any]] = []
    if analyze_comments:
        comment_texts = [(c.content or "").strip() for c in real_comments if (c.content or "").strip()]
        if comment_texts:
            try:
                comment_predictions = _predict_sentiments(comment_texts)
            except RuntimeError as e:
                raw = str(e)
                if raw in {"transformers_not_installed", "model_dir_not_found", "torch_not_installed"}:
                    raise HTTPException(status_code=503, detail=f"Comment sentiment unavailable: {raw}")
                raise HTTPException(status_code=503, detail=f"Comment sentiment unavailable: {raw}")
            except Exception as e:
                logging.error("Comment sentiment analysis failed for post %s: %s", post_id, str(e), exc_info=True)
                raise HTTPException(status_code=500, detail="Failed to analyze comments")

    prediction_idx = 0
    for c in real_comments:
        text = (c.content or "").strip()
        pred = None
        if analyze_comments and text and prediction_idx < len(comment_predictions):
            pred = comment_predictions[prediction_idx]
            prediction_idx += 1

        comments.append({
            "id": c.id,
            "content": c.content,
            "author_id": c.author_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "author": {
                "id": c.author.id if c.author else None,
                "display_name": c.author.display_name if c.author else None,
                "email": c.author.email if c.author else None,
                "avatar_url": getattr(c.author, "avatar_url", None) if c.author else None,
            },
            "sentiment_label": pred.get("label") if pred else None,
            "sentiment_label_id": pred.get("label_id") if pred else None,
            "sentiment_score": pred.get("score") if pred else None,
        })

    return {
        "id": p.id,
        "content": p.content,
        "created_at": getattr(p, "created_at", None),
        "media_url": getattr(p, "media_url", None),
        "media_type": getattr(p, "media_type", None),
        "like_count": int(p.like_count or 0),
        "comment_count": len([c for c in (p.comments or []) if c.content != "__LIKE__"]),
        "author": {
            "id": p.author.id if p.author else None,
            "display_name": p.author.display_name if p.author else None,
            "email": p.author.email if p.author else None,
            "avatar_url": getattr(p.author, "avatar_url", None) if p.author else None,
        },
        "comments": comments,
        "comments_analyzed": analyze_comments,
    }


@router.get("/sentiment/posts", dependencies=[Depends(admin_required)])
def admin_sentiment_posts(
    db: Session = Depends(get_db),
    q: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    refresh: bool = Query(False),
):
    try:
        logging.info(f"[Sentiment] Loading posts: q={q}, limit={limit}, offset={offset}")
        query = db.query(Post).options(joinedload(Post.author)).order_by(Post.id.desc())
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(Post.content.ilike(like))

        items = query.limit(limit).offset(offset).all()
        logging.info(f"[Sentiment] Loaded {len(items)} posts")

        post_ids = [int(p.id) for p in items]
        cache_map = {} if refresh else _get_sentiment_cache_map(db, post_ids)

        texts: List[str] = []
        indexes: List[int] = []
        text_hash_by_index: Dict[int, str] = {}
        preds: Dict[int, Dict[str, Any]] = {}
        cache_hits = 0

        for i, p in enumerate(items):
            text = _normalize_post_text(getattr(p, "content", None))
            if not text:
                continue

            text_hash = _post_text_hash(text)
            cached = cache_map.get(int(p.id))
            if (
                cached
                and str(getattr(cached, "content_hash", "")) == text_hash
                and str(getattr(cached, "model_ref", "") or "") == SENTIMENT_MODEL_REF
                and getattr(cached, "sentiment_label", None) is not None
            ):
                preds[i] = {
                    "label": cached.sentiment_label,
                    "score": float(cached.sentiment_score) if cached.sentiment_score is not None else None,
                    "label_id": int(cached.sentiment_label_id) if cached.sentiment_label_id is not None else None,
                    "cached": True,
                    "cached_at": cached.analyzed_at.isoformat() if getattr(cached, "analyzed_at", None) else None,
                }
                cache_hits += 1
                continue

            texts.append(text)
            indexes.append(i)
            text_hash_by_index[i] = text_hash

        logging.info(f"[Sentiment] Cache hits={cache_hits}, analyze_now={len(texts)}")
        cache_updates: List[Dict[str, Any]] = []
        if texts:
            try:
                fresh = _predict_sentiments(texts)
                for i, pred in zip(indexes, fresh):
                    preds[i] = {
                        "label": pred.get("label"),
                        "score": pred.get("score"),
                        "label_id": pred.get("label_id"),
                        "cached": False,
                        "cached_at": None,
                    }
                    if pred.get("label") is not None and pred.get("label_id") is not None and pred.get("score") is not None:
                        cache_updates.append({
                            "post_id": int(items[i].id),
                            "content_hash": text_hash_by_index[i],
                            "label": str(pred.get("label")),
                            "label_id": int(pred.get("label_id")),
                            "score": float(pred.get("score")),
                        })
            except RuntimeError as e:
                raw = str(e)
                if raw in {"transformers_not_installed", "model_dir_not_found", "torch_not_installed"}:
                    raise HTTPException(status_code=503, detail=f"Model unavailable: {raw}")
                raise HTTPException(status_code=503, detail=f"Model unavailable: {raw}")
            except Exception as e:
                logging.error(f"[Sentiment] Analysis error: {str(e)}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Analysis error: {str(e)}")

        _upsert_sentiment_cache(db=db, cache_map=cache_map, rows=cache_updates)

        out_items = []
        label_counts: Dict[str, int] = {}
        for i, p in enumerate(items):
            pred = preds.get(i)
            label = pred.get("label") if pred else None
            score = pred.get("score") if pred else None
            if label:
                label_counts[label] = label_counts.get(label, 0) + 1
            out_items.append({
                "id": p.id,
                "content": p.content,
                "created_at": getattr(p, "created_at", None),
                "media_url": getattr(p, "media_url", None),
                "media_type": getattr(p, "media_type", None),
                "author": {
                    "id": p.author.id if p.author else None,
                    "display_name": p.author.display_name if p.author else None,
                    "email": p.author.email if p.author else None,
                    "avatar_url": getattr(p.author, "avatar_url", None) if p.author else None,
                    "date_of_birth": p.author.date_of_birth.isoformat() if (p.author and getattr(p.author, "date_of_birth", None)) else None,
                },
                "sentiment_label": label,
                "sentiment_label_id": pred.get("label_id") if pred else None,
                "sentiment_score": score,
                "sentiment_cached": bool(pred.get("cached")) if pred else False,
                "sentiment_cached_at": pred.get("cached_at") if pred else None,
            })

        logging.info(f"[Sentiment] Returning {len(out_items)} items")
        return {
            "items": out_items,
            "summary": {
                "total_posts": len(items),
                "total_analyzed": len(texts),
                "total_cached": cache_hits,
                "label_counts": label_counts,
            },
            "limit": limit,
            "offset": offset,
            "refresh": refresh,
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[Sentiment] Unhandled error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@router.get("/overall/posts", dependencies=[Depends(admin_required)])
def admin_overall_posts(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    q: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    background: bool = Query(True, description="Trả cache trước và phân tích bài chưa cache ở nền"),
    refresh: bool = Query(False, description="Bỏ cache mô tả media và phân tích lại từ đầu"),
):
    query = (
        db.query(Post)
        .options(joinedload(Post.author))
        .order_by(Post.id.desc())
    )
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Post.content.ilike(like), Post.media_url.ilike(like)))

    posts = query.limit(limit).offset(offset).all()
    post_ids = [int(p.id) for p in posts]
    sentiment_cache_map = _get_sentiment_cache_map(db=db, post_ids=post_ids)

    out_items: List[Dict[str, Any]] = []
    warmup_post_ids: List[int] = []
    cached_count = 0

    for p in posts:
        media_url = getattr(p, "media_url", None)
        media_path = _resolve_media_file_path(media_url)
        caption_text = _normalize_post_text(getattr(p, "content", None))
        media_signature = _file_signature(media_path)
        input_hash = _overall_input_hash(
            caption_text=caption_text,
            media_url=media_url,
            media_type=getattr(p, "media_type", None),
            media_signature=media_signature,
        )

        cached_overall = None if refresh else _get_cached_overall_analysis(db=db, post_id=p.id, input_hash=input_hash)

        sentiment_cache = sentiment_cache_map.get(int(p.id))
        fallback_label = _normalize_to_three_label(getattr(sentiment_cache, "sentiment_label", None)) if sentiment_cache else None
        fallback_score = float(getattr(sentiment_cache, "sentiment_score", 0.0) or 0.0) if sentiment_cache else None

        if cached_overall:
            # Backfill missing overall label from local sentiment cache so charts stay complete.
            if not cached_overall.get("overall_sentiment_label") and fallback_label:
                cached_overall["overall_sentiment_label"] = fallback_label
                cached_overall["overall_sentiment_score"] = cached_overall.get("overall_sentiment_score") or fallback_score
                cached_overall["overall_source"] = cached_overall.get("overall_source") or "sentiment_cache_fallback"

            if not cached_overall.get("model_sentiment_label") and fallback_label:
                cached_overall["model_sentiment_label"] = fallback_label
                cached_overall["model_sentiment_score"] = cached_overall.get("model_sentiment_score") or fallback_score

            cached_count += 1
            out_items.append(cached_overall)
            continue

        if background:
            warmup_post_ids.append(p.id)
            pending_row = _build_overall_pending_row(
                p=p,
                caption_text=caption_text,
                media_url=media_url,
                media_type=getattr(p, "media_type", None),
                input_hash=input_hash,
                media_analysis=None,
                media_error=None,
            )
            if fallback_label:
                pending_row["model_sentiment_label"] = fallback_label
                pending_row["model_sentiment_score"] = fallback_score
                pending_row["overall_sentiment_label"] = fallback_label
                pending_row["overall_sentiment_score"] = fallback_score
                pending_row["overall_source"] = "sentiment_cache_fallback"
                pending_row["overall_analysis_state"] = "fallback_ready"
                pending_row["overall_pending_reason"] = "dang warmup groq nen tam dung nhan tu sentiment cache"

            out_items.append(pending_row)
            continue

        row = _compute_overall_analysis_row(db=db, p=p, refresh=refresh)
        _save_overall_analysis_cache(
            db=db,
            post_id=int(row.get("id") or p.id),
            input_hash=str(row.get("overall_input_hash") or ""),
            payload=row,
        )
        row["overall_cached"] = True
        row["overall_cache_version"] = OVERALL_ANALYSIS_CACHE_VERSION
        out_items.append(row)

    if background and warmup_post_ids:
        background_tasks.add_task(_warm_overall_analysis_cache, warmup_post_ids, refresh)

    label_counts: Dict[str, int] = {}
    for row in out_items:
        label = row.get("overall_sentiment_label")
        if not label:
            continue
        label_counts[str(label)] = label_counts.get(str(label), 0) + 1

    return {
        "items": out_items,
        "summary": {
            "total_posts": len(posts),
            "total_analyzed": cached_count,
            "pending_count": len(warmup_post_ids),
            "label_counts": label_counts,
            "cached_count": cached_count,
        },
        "limit": limit,
        "offset": offset,
        "refresh": refresh,
        "background": background,
    }


@router.get("/vision/posts", dependencies=[Depends(admin_required)])
def admin_list_media_posts(
    db: Session = Depends(get_db),
    q: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    analyze: bool = Query(False),
    describe: bool = Query(False),
    refresh: bool = Query(False),
):
    query = (
        db.query(Post)
        .options(joinedload(Post.author))
        .filter(Post.media_type.in_(["image", "video"]))
        .order_by(Post.id.desc())
    )
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Post.content.ilike(like), Post.media_url.ilike(like)))

    rows = query.limit(limit).offset(offset).all()
    items = []
    for p in rows:
        item = {
            "id": p.id,
            "content": p.content,
            "created_at": getattr(p, "created_at", None),
            "media_url": getattr(p, "media_url", None),
            "media_type": getattr(p, "media_type", None),
            "author": {
                "id": p.author.id if p.author else None,
                "display_name": p.author.display_name if p.author else None,
                "email": p.author.email if p.author else None,
                "avatar_url": getattr(p.author, "avatar_url", None) if p.author else None,
            },
        }

        if analyze or describe:
            media_path = _resolve_media_file_path(item.get("media_url"))
            if not media_path:
                item["analysis"] = None
                item["analysis_error"] = "Không tìm thấy file media trên server"
            else:
                try:
                    analysis = None if refresh else _get_cached_analysis(
                        db=db,
                        post_id=p.id,
                        media_url=item.get("media_url"),
                    )
                    if not analysis:
                        analysis = _analyze_media_with_groq(
                            media_path=media_path,
                            media_type=item.get("media_type"),
                            post_content=item.get("content"),
                        )
                        analysis["cached"] = False
                        analysis["cached_at"] = None
                        _save_analysis_cache(
                            db=db,
                            post_id=p.id,
                            media_url=item.get("media_url"),
                            analysis=analysis,
                        )
                    item["analysis"] = analysis
                    item["analysis_error"] = None
                except Exception as e:
                    logging.error("Media description failed for post %s: %s", p.id, str(e), exc_info=True)
                    item["analysis"] = None
                    item["analysis_error"] = "Phân tích media thất bại"

        items.append(item)

    return {
        "items": items,
        "limit": limit,
        "offset": offset,
        "analyze": analyze,
        "describe": describe,
        "refresh": refresh,
    }


@router.post("/vision/posts/{post_id}/analyze", dependencies=[Depends(admin_required)])
def admin_analyze_post_image(
    post_id: int,
    describe: bool = Query(False),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.media_type not in ("image", "video") or not post.media_url:
        raise HTTPException(status_code=400, detail="Post has no analyzable media")

    media_path = _resolve_media_file_path(post.media_url)
    if not media_path:
        raise HTTPException(status_code=404, detail="Media file not found on server")

    try:
        analysis = None if refresh else _get_cached_analysis(
            db=db,
            post_id=post.id,
            media_url=post.media_url,
        )
        if not analysis:
            analysis = _analyze_media_with_groq(
                media_path=media_path,
                media_type=post.media_type,
                post_content=post.content,
            )
            analysis["cached"] = False
            analysis["cached_at"] = None
            _save_analysis_cache(
                db=db,
                post_id=post.id,
                media_url=post.media_url,
                analysis=analysis,
            )
    except Exception as e:
        logging.error("Media description failed for post %s: %s", post_id, str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to analyze media")

    return {
        "post_id": post.id,
        "media_url": post.media_url,
        "media_type": post.media_type,
        "analysis": analysis,
    }


@router.delete("/posts/{post_id}", status_code=204, dependencies=[Depends(admin_required)])
def admin_delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(admin_required),
):
    try:
        p = db.query(Post).filter(Post.id == post_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Post not found")

        post_author_id = p.author_id
        
        # Get all reporters for this post before deleting
        report_rows = db.query(Report).filter(Report.post_id == post_id).all()
        reporter_ids = [r.reporter_id for r in report_rows]
        
        # Delete cached image analysis for this post (if exists)
        db.query(ImageAnalysisCache).filter(ImageAnalysisCache.post_id == post_id).delete()
        db.query(PostSentimentCache).filter(PostSentimentCache.post_id == post_id).delete()
        db.query(OverallAnalysisCache).filter(OverallAnalysisCache.post_id == post_id).delete()
        db.query(RagDocumentIndex).filter(RagDocumentIndex.post_id == post_id).delete()
        db.query(ToxicLanguageCache).filter(ToxicLanguageCache.post_id == post_id).delete()

        # First, delete all related reports manually
        db.query(Report).filter(Report.post_id == post_id).delete()
        
        # Then delete comments (cascades should handle this, but do it explicitly)
        db.query(Comment).filter(Comment.post_id == post_id).delete()
        
        # Finally delete the post
        db.delete(p)
        db.commit()
        
        # Send notifications to all reporters (best effort)
        for reporter_id in reporter_ids:
            try:
                send_notification(
                    db,
                    user_id=reporter_id,
                    actor_id=admin.id,
                    post_id=None,
                    notif_type="report_post_deleted",
                    text="Báo cáo của bạn đã được xử lý: bài viết đã bị xoá.",
                    dedupe=False,
                )
            except Exception as e:
                logging.error(f"Failed to notify reporter {reporter_id}: {e}")

        # Notify post author that their post was removed by admin (best effort)
        if post_author_id and post_author_id != admin.id:
            try:
                send_notification(
                    db,
                    user_id=post_author_id,
                    actor_id=admin.id,
                    post_id=None,
                    notif_type="admin_post_deleted",
                    text="Bài viết của bạn đã bị quản trị viên xóa do vi phạm nội dung.",
                    dedupe=False,
                )
            except Exception as e:
                logging.error(f"Failed to notify post author {post_author_id}: {e}")
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting post {post_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting post: {str(e)}")


@router.get("/users", dependencies=[Depends(admin_required)])
def admin_list_users(
    db: Session = Depends(get_db),
    q: str | None = None,
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    query = (
        db.query(User)
        .filter(func.lower(User.email) != SUPER_ADMIN_EMAIL)
        .order_by(User.id.desc())
    )
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (User.email.ilike(like)) | (User.display_name.ilike(like))
        )
    rows = query.limit(limit).offset(offset).all()
    items = []
    for u in rows:
        post_count = len(u.posts) if hasattr(u, 'posts') and u.posts else 0
        items.append({
            "id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "avatar_url": getattr(u, "avatar_url", None),
            "post_count": post_count,
            "is_admin": bool(getattr(u, "is_admin", False)),
            "created_at": getattr(u, "created_at", None),
        })
    return {"items": items, "limit": limit, "offset": offset}


@router.get("/reports")
def admin_list_reports(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(admin_required)
):
    """
    Lấy danh sách tất cả reports, có kèm thông tin post và reporter.
    """
    reports = (
        db.query(Report)
        .options(joinedload(Report.post), joinedload(Report.reporter))
        .order_by(Report.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    
    items = []
    for r in reports:
        post_data = None
        if r.post:
            # Lấy thông tin cơ bản của post
            # Đếm comment thường (không phải like)
            comment_count = len([c for c in (r.post.comments or []) if c.content != "__LIKE__"])
            # Sử dụng like_count từ Post model (nếu có) hoặc đếm từ comments
            like_count = getattr(r.post, 'like_count', 0) or len([c for c in (r.post.comments or []) if c.content == "__LIKE__"])
            
            post_data = {
                "id": r.post.id,
                "content": r.post.content,
                "media_url": r.post.media_url,
                "media_type": getattr(r.post, 'media_type', None),
                "created_at": r.post.created_at.isoformat() if r.post.created_at else None,
                "like_count": like_count,
                "comment_count": comment_count,
                "author": {
                    "id": r.post.author.id if r.post.author else None,
                    "username": (getattr(r.post.author, "username", None) or getattr(r.post.author, "email", None)) if r.post.author else None,
                    "display_name": r.post.author.display_name if r.post.author else None,
                    "avatar_url": getattr(r.post.author, "avatar_url", None) if r.post.author else None,
                }
            }
        
        reporter_data = None
        if r.reporter:
            reporter_data = {
                "id": r.reporter.id,
                "username": getattr(r.reporter, "username", None) or getattr(r.reporter, "email", None),
                "display_name": r.reporter.display_name,
            }
        
        items.append({
            "id": r.id,
            "post_id": r.post_id,
            "reporter_id": r.reporter_id,
            "reason": r.reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "post": post_data,
            "reporter": reporter_data,
        })
    
    return {"items": items, "limit": limit, "offset": offset}


@router.get("/toxic-language/posts", dependencies=[Depends(admin_required)])
def admin_toxic_language_posts(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    flagged_only: bool = Query(True),
    min_score: float = Query(0.55, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    """
    Auto-flag toxic Vietnamese text from posts.
    Only process posts that have text content (non-empty content).
    """
    query = (
        db.query(Post, ToxicLanguageCache)
        .join(ToxicLanguageCache, ToxicLanguageCache.post_id == Post.id)
        .options(joinedload(Post.author))
        .order_by(Post.created_at.desc(), Post.id.desc())
    )

    if flagged_only:
        query = query.filter(ToxicLanguageCache.is_toxic.is_(True)).filter(
            func.coalesce(ToxicLanguageCache.toxic_score, 0.0) >= min_score
        )

    rows = query.limit(limit).offset(offset).all()

    items: List[Dict[str, Any]] = []
    for p, cache in rows:
        categories = []
        matched_terms = []
        try:
            categories = json.loads(cache.categories_json or "[]")
            if not isinstance(categories, list):
                categories = []
        except Exception:
            categories = []
        try:
            matched_terms = json.loads(cache.matched_terms_json or "[]")
            if not isinstance(matched_terms, list):
                matched_terms = []
        except Exception:
            matched_terms = []

        score = float(cache.toxic_score) if isinstance(cache.toxic_score, (int, float)) else None
        is_toxic = bool(cache.is_toxic)
        flagged = bool(is_toxic and isinstance(score, (int, float)) and float(score) >= float(min_score))

        analysis = {
            "has_text": True,
            "is_toxic": cache.is_toxic,
            "toxic_score": score,
            "severity": cache.severity,
            "reason": cache.reason,
            "categories": categories,
            "matched_terms": matched_terms,
            "model": cache.model,
            "source": cache.source,
            "error": cache.error,
            "error_code": cache.error_code,
            "cached": True,
            "cached_at": cache.analyzed_at.isoformat() if cache.analyzed_at else None,
        }

        items.append(
            {
                "post_id": p.id,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "content": p.content,
                "media_url": p.media_url,
                "media_type": p.media_type,
                "author": {
                    "id": p.author.id if p.author else None,
                    "display_name": p.author.display_name if p.author else None,
                    "email": p.author.email if p.author else None,
                    "avatar_url": getattr(p.author, "avatar_url", None) if p.author else None,
                },
                "toxic_analysis": analysis,
                "flagged": flagged,
            }
        )

    return {
        "items": items,
        "limit": limit,
        "offset": offset,
        "flagged_only": flagged_only,
        "min_score": min_score,
        "source": "groq",
    }


@router.delete("/reports/{report_id}", status_code=204, dependencies=[Depends(admin_required)])
def admin_delete_report(
    report_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(admin_required),
):
    try:
        report = db.query(Report).filter(Report.id == report_id).first()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        
        # Save reporter info before deleting
        reporter_id = report.reporter_id
        post_id = report.post_id
        
        # Delete the report
        db.delete(report)
        db.commit()
        
        # Send notification to reporter (best effort)
        try:
            send_notification(
                db,
                user_id=reporter_id,
                actor_id=admin.id,
                post_id=post_id,
                notif_type="report_dismissed",
                text="Báo cáo của bạn đã được xem xét và không được chấp nhận.",
                dedupe=False,
            )
        except Exception as e:
            logging.error(f"Failed to send dismissal notification: {e}")
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting report {report_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting report: {str(e)}")


@router.delete("/users/{user_id}", status_code=204, dependencies=[Depends(admin_required)])
def admin_delete_user(user_id: int, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if bool(getattr(u, "is_admin", False)):
        raise HTTPException(status_code=400, detail="Không xoá admin")

    try:
        # User.posts đang dùng passive_deletes=True nhưng FK posts.author_id không có
        # ON DELETE CASCADE ở schema hiện tại, nên cần dọn thủ công để tránh lỗi FK.
        user_post_ids = [pid for (pid,) in db.query(Post.id).filter(Post.author_id == user_id).all()]

        if user_post_ids:
            db.query(Notification).filter(Notification.post_id.in_(user_post_ids)).delete(synchronize_session=False)
            db.query(Report).filter(Report.post_id.in_(user_post_ids)).delete(synchronize_session=False)
            db.query(Comment).filter(Comment.post_id.in_(user_post_ids)).delete(synchronize_session=False)
            db.query(ToxicLanguageCache).filter(ToxicLanguageCache.post_id.in_(user_post_ids)).delete(synchronize_session=False)

        db.query(Notification).filter(
            or_(Notification.user_id == user_id, Notification.actor_id == user_id)
        ).delete(synchronize_session=False)
        db.query(Report).filter(Report.reporter_id == user_id).delete(synchronize_session=False)
        db.query(Comment).filter(Comment.author_id == user_id).delete(synchronize_session=False)
        db.query(FriendRequest).filter(
            or_(FriendRequest.sender_id == user_id, FriendRequest.receiver_id == user_id)
        ).delete(synchronize_session=False)
        db.query(Friendship).filter(
            or_(Friendship.user_id == user_id, Friendship.friend_id == user_id)
        ).delete(synchronize_session=False)
        db.query(Post).filter(Post.author_id == user_id).delete(synchronize_session=False)

        db.delete(u)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        logging.error("Integrity error deleting user %s: %s", user_id, str(e), exc_info=True)
        raise HTTPException(
            status_code=409,
            detail="Không thể xoá người dùng do còn dữ liệu liên quan.",
        )
    except Exception as e:
        db.rollback()
        logging.error("Error deleting user %s: %s", user_id, str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Lỗi khi xoá người dùng")
