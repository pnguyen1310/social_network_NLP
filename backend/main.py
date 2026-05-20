# main.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response

from db import Base, engine

# Import models để Base.metadata.create_all nhìn thấy tất cả bảng
from models import user as _user  # noqa: F401
from models import post as _post  # noqa: F401
from models import comment as _comment  # noqa: F401
from models import notification as _notification  # noqa: F401
from models import friend as _friend  # noqa: F401
from models import report as _report  # noqa: F401
from models import image_analysis as _image_analysis  # noqa: F401
from models import post_sentiment_cache as _post_sentiment_cache  # noqa: F401
from models import overall_analysis_cache as _overall_analysis_cache  # noqa: F401
from models import rag_document_index as _rag_document_index  # noqa: F401
from models import toxic_language_cache as _toxic_language_cache  # noqa: F401

# Routers
from routes import auth, posts, users, admin, admin_rag, friends, user_chat

# Realtime manager (WebSocket)
from realtime import manager

# (Tùy chọn) router notifications
try:
    from routes.notifications import router as notifications_router  # type: ignore
    HAS_NOTIFICATIONS = True
except Exception:
    notifications_router = None  # type: ignore
    HAS_NOTIFICATIONS = False


APP_NAME: str = os.getenv("APP_NAME", "Social App Backend")
APP_VERSION: str = os.getenv("APP_VERSION", "1.0.0")

# ===== Static uploads (ảnh/video) =====
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
AVATAR_DIR = UPLOAD_DIR / "avatars"
POSTS_DIR = UPLOAD_DIR / "posts"

# Tạo thư mục nếu chưa có
for p in (UPLOAD_DIR, AVATAR_DIR, POSTS_DIR):
    p.mkdir(parents=True, exist_ok=True)

# ===== App =====
app = FastAPI(title=APP_NAME, version=APP_VERSION)

# ===== DB: tạo bảng nếu chưa có =====
# Lưu ý: create_all KHÔNG tự alter cột khi schema thay đổi. Dùng Alembic cho migration.
Base.metadata.create_all(bind=engine)

# ===== Middleware =====
# Custom CORS middleware - handle all CORS requests manually
@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    # Handle preflight OPTIONS requests
    if request.method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "3600",
            },
        )
    
    # For other requests, add CORS headers to response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

# Mount để FE có thể truy cập: `${API_BASE}/uploads/...`
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# ===== Routers =====
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(posts.router)
app.include_router(admin.router)
app.include_router(admin_rag.router)
app.include_router(user_chat.router)
app.include_router(friends.router)
if HAS_NOTIFICATIONS and notifications_router:
    app.include_router(notifications_router)


@app.on_event("startup")
def startup_preload_user_chat_model():
    try:
        user_chat._load_chat_model()
        logging.info("User chat model preloaded successfully.")
    except Exception:
        logging.exception("Failed to preload user chat model on startup")

# ===== Health/Test =====
@app.get("/")
def root():
    return {
        "ok": True,
        "app": APP_NAME,
        "version": APP_VERSION,
        "notifications_enabled": HAS_NOTIFICATIONS,
        "friends_enabled": True,
        "static_mount": "/uploads",
    }


@app.get("/healthz")
def healthz():
    return {"status": "ok"}

# ===== WebSocket realtime theo user_id =====
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int):
    """
    Mỗi user_id có thể mở nhiều tab -> tất cả socket đều được quản lý.
    Client không cần gửi message; server giữ kết nối để có thể push notify.
    """
    await manager.connect(websocket, user_id)
    try:
        while True:
            # Idle receive: giữ kết nối, đồng thời phát hiện disconnect
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
            except asyncio.TimeoutError:
                # Không nhận được gì trong 60s -> vẫn giữ kết nối
                continue
    except WebSocketDisconnect:
        logging.info("WebSocket disconnected: user_id=%s", user_id)
        manager.disconnect(websocket)
    except Exception as e:
        logging.exception("WebSocket error (user_id=%s): %s", user_id, e)
        manager.disconnect(websocket)
