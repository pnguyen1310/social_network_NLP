# routes/friends.py
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from db import get_db
from models.friend import FriendRequest, Friendship
from models.user import User
from routes.auth import current_non_admin_user
from services.notify import send_notification  # nếu đang dùng hệ thống notif
from realtime import manager                   # nếu đang dùng WebSocket push

router = APIRouter(prefix="/friends", tags=["friends"])


# ===== Helpers =====
def mini_user(u: User | None):
    if not u:
        return None
    return {"id": u.id, "display_name": u.display_name, "email": u.email}


def serialize_request(fr: FriendRequest, me_id: int | None = None) -> dict:
    if me_id is None:
        direction = "me"
    elif fr.sender_id == me_id:
        direction = "outgoing"
    elif fr.receiver_id == me_id:
        direction = "incoming"
    else:
        direction = "me"

    return {
        "id": fr.id,
        "sender_id": fr.sender_id,
        "receiver_id": fr.receiver_id,
        "status": fr.status,
        "created_at": fr.created_at.isoformat() if fr.created_at else None,
        "direction": direction,
        "from_user": mini_user(fr.sender),
        "to_user": mini_user(fr.receiver),
    }


# ===== Status: none | outgoing | incoming | friends | me =====
@router.get("/status")
def friend_status(
    user_id: int = Query(..., description="ID người còn lại"),
    db: Session = Depends(get_db),
    me: User = Depends(current_non_admin_user),
):
    if user_id == me.id:
        return {"status": "me"}

    target = db.query(User).filter(User.id == user_id, User.is_admin.is_(False)).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Đã là bạn?
    fs = db.query(Friendship).filter(
        or_(
            and_(Friendship.user_id == me.id, Friendship.friend_id == user_id),
            and_(Friendship.user_id == user_id, Friendship.friend_id == me.id),
        )
    ).first()
    if fs:
        return {"status": "friends"}

    # Incoming: người kia đã gửi cho mình
    inc = db.query(FriendRequest).filter(
        FriendRequest.sender_id == user_id,
        FriendRequest.receiver_id == me.id,
        FriendRequest.status == "pending",
    ).first()
    if inc:
        return {"status": "incoming", "request_id": inc.id}

    # Outgoing: mình đã gửi cho họ
    out = db.query(FriendRequest).filter(
        FriendRequest.sender_id == me.id,
        FriendRequest.receiver_id == user_id,
        FriendRequest.status == "pending",
    ).first()
    if out:
        return {"status": "outgoing", "request_id": out.id}

    return {"status": "none"}


# ===== List requests (pending) =====
@router.get("/requests")
def list_requests(
    incoming: bool = Query(False),
    outgoing: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    q = (
        db.query(FriendRequest)
        .options(joinedload(FriendRequest.sender), joinedload(FriendRequest.receiver))
        .filter(FriendRequest.status == "pending")
    )
    if incoming:
        q = q.filter(FriendRequest.receiver_id == user.id)
    elif outgoing:
        q = q.filter(FriendRequest.sender_id == user.id)
    else:
        q = q.filter(
            or_(
                FriendRequest.sender_id == user.id,
                FriendRequest.receiver_id == user.id,
            )
        )

    items = q.order_by(FriendRequest.id.desc()).all()
    return {"items": [serialize_request(fr, me_id=user.id) for fr in items]}


# ===== Create request =====
@router.post("/requests")
def create_request(
    receiver_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    if receiver_id == user.id:
        raise HTTPException(status_code=400, detail="Không thể gửi lời mời cho chính mình")

    receiver = db.query(User).filter(User.id == receiver_id, User.is_admin.is_(False)).first()
    if not receiver:
        raise HTTPException(status_code=404, detail="User not found")

    # Đã là bạn?
    is_friend = db.query(Friendship).filter(
        or_(
            and_(Friendship.user_id == user.id, Friendship.friend_id == receiver_id),
            and_(Friendship.user_id == receiver_id, Friendship.friend_id == user.id),
        )
    ).first()
    if is_friend:
        raise HTTPException(status_code=409, detail="Đã là bạn bè")

    # Đã có pending mình -> họ?
    ex = db.query(FriendRequest).filter(
        FriendRequest.sender_id == user.id,
        FriendRequest.receiver_id == receiver_id,
        FriendRequest.status == "pending",
    ).first()
    if ex:
        db.refresh(ex, attribute_names=["sender", "receiver"])
        return serialize_request(ex, me_id=user.id)

    # Người kia đã gửi cho mình (pending ngược chiều)?
    reverse = db.query(FriendRequest).filter(
        FriendRequest.sender_id == receiver_id,
        FriendRequest.receiver_id == user.id,
        FriendRequest.status == "pending",
    ).first()
    if reverse:
        # Trả về request hiện có với direction=incoming để FE hiển thị "Chấp nhận/Từ chối"
        db.refresh(reverse, attribute_names=["sender", "receiver"])
        return serialize_request(reverse, me_id=user.id)

    # Tạo mới
    fr = FriendRequest(sender_id=user.id, receiver_id=receiver_id, status="pending")
    db.add(fr)
    db.commit()
    db.refresh(fr)
    db.refresh(fr, attribute_names=["sender", "receiver"])

    # Push notif / realtime (nếu dùng)
    try:
        if receiver_id != user.id:
            send_notification(
                db=db,
                user_id=receiver_id,
                actor_id=user.id,
                notif_type="friend_request",
                text=f"{user.display_name} đã gửi lời mời kết bạn.",
                dedupe=False,
            )
            manager.send_to_user(
                receiver_id,
                {"event": "friend_request", "id": fr.id, "from_user": mini_user(user)},
            )
    except Exception:
        pass

    return serialize_request(fr, me_id=user.id)


# ===== Accept / Decline (PUT để khớp FE) =====
@router.put("/requests/{req_id}/accept", status_code=status.HTTP_200_OK)
def accept_request(
    req_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    fr = (
        db.query(FriendRequest)
        .options(joinedload(FriendRequest.sender), joinedload(FriendRequest.receiver))
        .filter(
            FriendRequest.id == req_id,
            FriendRequest.receiver_id == user.id,
            FriendRequest.status == "pending",
        )
        .first()
    )
    if not fr:
        raise HTTPException(status_code=404, detail="Request not found")

    # Tạo friendship 2 chiều
    db.add_all(
        [
            Friendship(user_id=fr.sender_id, friend_id=fr.receiver_id),
            Friendship(user_id=fr.receiver_id, friend_id=fr.sender_id),
        ]
    )
    db.delete(fr)
    db.commit()

    # Notify người gửi
    try:
        if fr.sender_id != user.id:
            send_notification(
                db=db,
                user_id=fr.sender_id,
                actor_id=user.id,
                notif_type="friend_accept",
                text=f"{user.display_name} đã chấp nhận lời mời kết bạn.",
                dedupe=False,
            )
            manager.send_to_user(
                fr.sender_id, {"event": "friend_accept", "by": mini_user(user)}
            )
    except Exception:
        pass

    return {"ok": True}


@router.put("/requests/{req_id}/decline", status_code=status.HTTP_200_OK)
def reject_request(
    req_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_non_admin_user),
):
    fr = db.query(FriendRequest).filter(
        FriendRequest.id == req_id,
        FriendRequest.receiver_id == user.id,
        FriendRequest.status == "pending",
    ).first()
    if not fr:
        raise HTTPException(status_code=404, detail="Request not found")

    db.delete(fr)
    db.commit()
    return {"ok": True}


# ===== List friends of a user =====
@router.get("/of/{user_id}")
def list_friends_of(
    user_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(current_non_admin_user),  # chỉ user thường mới dùng tính năng kết bạn
):
    owner = db.query(User).filter(User.id == user_id, User.is_admin.is_(False)).first()
    if not owner:
        raise HTTPException(status_code=404, detail="User not found")

    # Lấy danh sách friend_id -> join sang User để trả tên/email
    rows = (
        db.query(Friendship, User)
        .join(User, User.id == Friendship.friend_id)
        .filter(Friendship.user_id == user_id, User.is_admin.is_(False))
        .order_by(User.display_name.asc())
        .limit(limit)
        .all()
    )

    items = []
    for _, u in rows:
        items.append(
            {
                "friend_id": u.id,
                "display_name": u.display_name,
                "email": u.email,
            }
        )
    return {"items": items}
