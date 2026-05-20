from __future__ import annotations

import logging
import os
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import get_db
from models.user import User
from routes.auth import current_non_admin_user

logger = logging.getLogger("backend.user_chat")

CHAT_MODEL_DIR = Path(
    os.getenv("QWEN_LORA_ADAPTER_DIR", Path(__file__).resolve().parents[2] / "qwen_lora_adapter")
).expanduser().resolve()
QWEN_LORA_BASE_MODEL = os.getenv("QWEN_LORA_BASE_MODEL", "Qwen/Qwen2-1.5B").strip()
if QWEN_LORA_BASE_MODEL:
    try:
        maybe_path = Path(QWEN_LORA_BASE_MODEL).expanduser().resolve()
        if maybe_path.exists():
            QWEN_LORA_BASE_MODEL = str(maybe_path)
    except Exception:
        pass
QWEN_LORA_MAX_NEW_TOKENS = max(16, min(512, int(os.getenv("QWEN_LORA_MAX_NEW_TOKENS", "80"))))
QWEN_LORA_MAX_INPUT_TOKENS = max(512, min(8192, int(os.getenv("QWEN_LORA_MAX_INPUT_TOKENS", "4096"))))
QWEN_LORA_TEMPERATURE = float(os.getenv("QWEN_LORA_TEMPERATURE", "0.0"))
QWEN_LORA_TOP_P = float(os.getenv("QWEN_LORA_TOP_P", "0.9"))
QWEN_LORA_REPETITION_PENALTY = float(os.getenv("QWEN_LORA_REPETITION_PENALTY", "1.05"))
QWEN_LORA_SYSTEM_PROMPT = (
    "Bạn là trợ lý AI tiếng Việt hữu ích, tự nhiên và chính xác. "
    "Chỉ trả lời trực tiếp và ngắn gọn cho câu hỏi hiện tại. "
    "Không giải thích quá nhiều, không mở rộng sang chủ đề khác, không lặp lại đề bài, không thêm thông tin không liên quan. "
    "Chỉ trả lời câu hỏi cuối cùng của người dùng và không nhắc lại lịch sử hội thoại. "
    "Nếu câu hỏi yêu cầu một câu trả lời đơn giản, chỉ trả lời đúng nội dung chính xác. "
    "Không bịa đặt, không tự suy đoán quá mức. Nếu thiếu dữ liệu hoặc không chắc chắn, hãy trả lời: 'Xin lỗi, tôi không biết.'"
)

# Gợi ý bổ sung: yêu cầu model trả lời ngắn gọn tối đa 100 token
QWEN_LORA_SYSTEM_PROMPT = QWEN_LORA_SYSTEM_PROMPT + " Trả lời ngắn gọn và súc tích, không quá 100 token."

router = APIRouter(prefix="/user", tags=["user-chat"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1)


class UserChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_items=1)
    max_new_tokens: int | None = Field(None, description="Optional hint for max new tokens to generate")


class UserChatResponse(BaseModel):
    reply: str
    raw_reply: str | None = None
    processing_time_ms: float


@lru_cache(maxsize=1)
def _load_chat_model() -> Dict[str, Any]:
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except Exception as exc:
        raise RuntimeError("transformers_not_installed") from exc

    try:
        from peft import PeftModel
    except Exception as exc:
        raise RuntimeError("peft_not_installed") from exc

    try:
        import torch
    except Exception as exc:
        raise RuntimeError("torch_not_installed") from exc

    if not CHAT_MODEL_DIR.exists():
        raise RuntimeError("qwen_lora_adapter_directory_missing")

    tokenizer = AutoTokenizer.from_pretrained(
        str(CHAT_MODEL_DIR),
        use_fast=True,
        trust_remote_code=True,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    if tokenizer.eos_token is None:
        tokenizer.eos_token = tokenizer.pad_token

    use_cuda = torch.cuda.is_available()
    device = torch.device("cuda" if use_cuda else "cpu")
    logger.info(
        "Loading QWen-LoRA chat model: base=%s adapter=%s use_cuda=%s",
        QWEN_LORA_BASE_MODEL,
        CHAT_MODEL_DIR,
        use_cuda,
    )
    model = AutoModelForCausalLM.from_pretrained(
        QWEN_LORA_BASE_MODEL,
        device_map="auto" if use_cuda else None,
        torch_dtype=torch.float16 if use_cuda else torch.float32,
        trust_remote_code=True,
    )
    model = PeftModel.from_pretrained(
        model,
        str(CHAT_MODEL_DIR),
        torch_dtype=torch.float16 if use_cuda else torch.float32,
    )
    model.eval()

    if not use_cuda:
        model.to(device)

    return {
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
    }


ROLE_MARKER_PATTERN = re.compile(
    r"^(?:<\|im_end\|>\s*)?(?:<\|im_start\|>\s*)?(?:assistant|user|system|bot)\b\s*(?:[:\-–]\s*)?",
    flags=re.I,
)

ROLE_MARKER_CUTOFF_PATTERN = re.compile(
    r"(?is)^(?:<\|im_end\|>\s*)?(?:<\|im_start\|>\s*)?(assistant|user|system|bot)\b\s*(?:[:\-–]\s*)?",
)


def _strip_role_markers(text: str) -> str:
    """Remove common role markers (assistant/user/system/bot) that appear at line starts.

    This preserves the model output content but strips labels like "user:" or "assistant:".
    """
    if not text:
        return ""
    try:
        pattern = re.compile(r"(?im)^(?:<\|im_end\|>\s*)?(?:<\|im_start\|>\s*)?(?:assistant|user|system|bot)\b\s*[:\-–]?\s*")
        return pattern.sub("", text).strip()
    except Exception:
        return text


def _extract_last_assistant_segment(text: str) -> str:
    """If model output contains multiple role-marked segments, return the last assistant segment.

    Fallback to original text if no assistant marker found.
    """
    if not text:
        return ""
    try:
        pattern = re.compile(
            r"(?im)(?:<\|im_end\|>\s*)?(?:<\|im_start\|>\s*)?(assistant|user|system|bot)\b\s*(?:[:\-–]\s*)?"
        )
        matches = list(pattern.finditer(text))
        if not matches:
            return text

        segments = []
        for idx, match in enumerate(matches):
            role = (match.group(1) or "").lower()
            start = match.end()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
            segments.append((role, text[start:end].strip()))

        for role, segment in reversed(segments):
            if role == "assistant" and segment:
                return segment

        # fallback to last segment if no assistant label found
        return segments[-1][1] if segments else text
    except Exception:
        return text


def _truncate_at_role_marker(text: str) -> str:
    if not text:
        return ""

    lines = []
    for raw_line in str(text).splitlines():
        line = raw_line.strip()
        if ROLE_MARKER_CUTOFF_PATTERN.match(line):
            break
        lines.append(raw_line)

    return "\n".join(lines).strip()


def _clean_assistant_reply(text: str) -> str:
    if not text:
        return ""

    text = _truncate_at_role_marker(str(text))
    text = _extract_last_assistant_segment(text)

    cleaned_lines = []
    for raw_line in str(text).splitlines():
        line = raw_line.strip()
        if not line:
            continue

        while True:
            updated = ROLE_MARKER_PATTERN.sub("", line)
            if updated == line:
                break
            line = updated.strip()

        line = re.sub(r"^(?:>\s*)+", "", line).strip()
        if line:
            cleaned_lines.append(line)

    if not cleaned_lines:
        return ""

    text = "\n".join(cleaned_lines)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _sanitize_text(text: str) -> str:
    return _clean_assistant_reply(text)


def _build_prompt(tokenizer: Any, messages: List[Dict[str, str]]) -> str:
    try:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    except Exception:
        lines = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            lines.append(f"<{role}>: {content}")
        lines.append("<assistant>:")
        return "\n".join(lines)


def _generate_answer(messages: List[Dict[str, str]], max_new_tokens: int | None = None) -> tuple[str, str]:
    print(f"📨 _generate_answer called with max_new_tokens={max_new_tokens}")
    if not any(m.get("role") == "system" for m in messages):
        messages = [
            {
                "role": "system",
                "content": QWEN_LORA_SYSTEM_PROMPT,
            }
        ] + messages

    # Truncate history to last N turns (keep most recent assistant/user pairs)
    # Keep system prompt at index 0 if present.
    max_turns = 6
    if len(messages) > 1:
        system = messages[0] if messages[0].get("role") == "system" else None
        rest = messages[1:] if system else messages
        # keep last max_turns messages
        rest = rest[-max_turns:]
        messages = ([system] if system else []) + rest

    pipe = _load_chat_model()
    model = pipe["model"]
    tokenizer = pipe["tokenizer"]
    device = pipe["device"]

    prompt = _build_prompt(tokenizer, messages)
    max_input_tokens = min(int(getattr(tokenizer, "model_max_length", QWEN_LORA_MAX_INPUT_TOKENS) or QWEN_LORA_MAX_INPUT_TOKENS), QWEN_LORA_MAX_INPUT_TOKENS)
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=max_input_tokens)
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # determine final max_new_tokens (bound between 16 and 512)
    if max_new_tokens is None:
        final_max_new_tokens = int(QWEN_LORA_MAX_NEW_TOKENS)
    else:
        try:
            final_max_new_tokens = max(16, min(512, int(max_new_tokens)))
        except Exception:
            final_max_new_tokens = int(QWEN_LORA_MAX_NEW_TOKENS)
    
    print(f"🔵 QWEN_LORA_MAX_NEW_TOKENS={QWEN_LORA_MAX_NEW_TOKENS}, final_max_new_tokens={final_max_new_tokens}")

    with __import__("torch").no_grad():
        do_sample = QWEN_LORA_TEMPERATURE > 0.0
        outputs = model.generate(
            **inputs,
            max_new_tokens=final_max_new_tokens,
            temperature=max(0.0, min(2.0, QWEN_LORA_TEMPERATURE)),
            top_p=max(0.05, min(1.0, QWEN_LORA_TOP_P)) if do_sample else 1.0,
            do_sample=do_sample,
            repetition_penalty=max(1.0, QWEN_LORA_REPETITION_PENALTY),
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    generated = outputs[0][inputs["input_ids"].shape[1] :]
    answer = tokenizer.decode(generated, skip_special_tokens=True).strip()
    print(f"🔴 RAW OUTPUT ({len(generated)} tokens, len={len(answer)}): {answer}")
    cleaned = _clean_assistant_reply(answer)
    # strip role markers for raw output we return to clients
    raw_sanitized = _strip_role_markers(answer)
    # additionally remove any remaining standalone role labels anywhere in text
    try:
        raw_sanitized = re.sub(r"(?i)\b(?:assistant|user|system|bot)\b\s*[:\-–]?\s*", "", raw_sanitized)
        raw_sanitized = re.sub(r"[ \t]+", " ", raw_sanitized).strip()
        # if model embedded multiple role segments, prefer last assistant segment
        raw_last = _extract_last_assistant_segment(raw_sanitized)
        if raw_last:
            raw_sanitized = raw_last
    except Exception:
        pass
    print(f"🟢 AFTER CLEAN: {cleaned}")
    print(f"🔵 RAW SANITIZED: {raw_sanitized}")
    return cleaned, raw_sanitized


@router.post("/chat", response_model=UserChatResponse)
def user_chat(
    payload: UserChatRequest,
    user: User = Depends(current_non_admin_user),
    db: Session = Depends(get_db),
):
    """
    Chat endpoint dành riêng cho người dùng đăng nhập.
    Mỗi request chỉ trả về câu trả lời của chatbot cho user hiện tại.
    """
    if len(payload.messages) > 40:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many messages in payload",
        )

    started_at = time.perf_counter()
    try:
        reply, raw = _generate_answer([m.dict() for m in payload.messages], max_new_tokens=payload.max_new_tokens)
    except RuntimeError as exc:
        detail = str(exc)
        if detail == "transformers_not_installed":
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="transformers library is not installed")
        if detail == "peft_not_installed":
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="peft library is not installed")
        if detail == "torch_not_installed":
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="torch is not installed")
        if detail == "qwen_lora_adapter_directory_missing":
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="qwen_lora_adapter directory is missing")
        logger.exception("User chat runtime error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail)
    except Exception as exc:
        logger.exception("Unexpected user chat error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Chat model unavailable: {exc}")

    processing_time_ms = round((time.perf_counter() - started_at) * 1000.0, 2)
    return {"reply": reply, "raw_reply": raw, "processing_time_ms": processing_time_ms}


@router.get("/health")
def user_chat_health():
    """
    Kiểm tra trạng thái model chatbot.
    """
    try:
        _load_chat_model()
        return {"status": "ok", "model_loaded": True}
    except Exception as exc:
        logger.exception("User chat health check failed")
        return {"status": "error", "model_loaded": False, "error": str(exc)}
