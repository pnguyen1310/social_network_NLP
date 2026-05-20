# realtime.py
from typing import Dict, List, Any
from fastapi import WebSocket
import json
import asyncio

class ConnectionManager:
    def __init__(self) -> None:
        # user_id -> list[WebSocket]
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int) -> None:
        # QUAN TRỌNG: phải accept() thì mới nhận được tin
        await websocket.accept()
        self.active_connections.setdefault(user_id, []).append(websocket)
        print(f"✅ WS connected: user={user_id}, conns={len(self.active_connections[user_id])}")

    def disconnect(self, websocket: WebSocket) -> None:
        for uid, conns in list(self.active_connections.items()):
            if websocket in conns:
                conns.remove(websocket)
                print(f"❌ WS disconnected: user={uid}, conns={len(conns)}")
                if not conns:
                    del self.active_connections[uid]
                break

    async def send_to_user(self, user_id: int, payload: Any) -> None:
        """Gửi 1 message JSON tới tất cả socket của user_id (nếu online)."""
        conns = self.active_connections.get(user_id)
        if not conns:
            print(f"ℹ️ user {user_id} offline, skip realtime")
            return

        data = payload if isinstance(payload, str) else json.dumps(payload)

        async def _safe_send(ws: WebSocket):
            try:
                await ws.send_text(data)
            except Exception:
                # nếu đứt kết nối thì dọn
                self.disconnect(ws)

        await asyncio.gather(*[_safe_send(ws) for ws in list(conns)], return_exceptions=True)

    async def broadcast(self, payload: Any) -> None:
        """Gửi message tới tất cả websocket của mọi user."""
        data = payload if isinstance(payload, str) else json.dumps(payload)
        all_ws = [ws for conns in self.active_connections.values() for ws in conns]

        async def _safe_send(ws: WebSocket):
            try:
                await ws.send_text(data)
            except Exception:
                self.disconnect(ws)

        await asyncio.gather(*[_safe_send(ws) for ws in all_ws], return_exceptions=True)

manager = ConnectionManager()
