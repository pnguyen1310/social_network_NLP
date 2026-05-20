# routes/auth.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, constr, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from db import get_db
from models.user import User
from utils.jwt import create_token, decode_token

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)

# BCrypt for hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------- Schemas ----------
class RegisterIn(BaseModel):
    display_name: constr(min_length=1, max_length=64)
    # Cho phép email nội bộ (vd: admin@local) -> dùng string + validator
    email: constr(min_length=3, max_length=255)
    password: constr(min_length=6, max_length=64)
    date_of_birth: date  # YYYY-MM-DD

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        # kiểm tra tối thiểu: có '@' và không ở đầu/cuối
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("Email không hợp lệ")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def validate_dob(cls, v: date) -> date:
        today = date.today()
        if v > today:
            raise ValueError("Ngày sinh không được lớn hơn ngày hiện tại.")
        age = (today - v).days / 365.25
        if age < 13:
            raise ValueError("Người dùng phải từ 13 tuổi trở lên.")
        return v


class LoginIn(BaseModel):
    # Cho phép email nội bộ
    email: constr(min_length=3, max_length=255)
    password: constr(min_length=6, max_length=64)

    @field_validator("email")
    @classmethod
    def normalize_login_email(cls, v: str) -> str:
        return v.strip().lower()


# ---------- Helpers ----------
def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _build_login_response(user: User) -> dict:
    role = "ADMIN" if bool(getattr(user, "is_admin", False)) else "USER"
    token = create_token({"uid": user.id, "role": role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": role,
        "is_admin": role == "ADMIN",
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "avatar_url": getattr(user, "avatar_url", None),
        },
    }


def current_user(
    db: Session = Depends(get_db),
    cred: HTTPAuthorizationCredentials = Depends(bearer),
) -> User:
    if not cred:
        # kèm header WWW-Authenticate để client hiểu cần Bearer
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )

    data = decode_token(cred.credentials)
    if not data or "uid" not in data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == data.get("uid")).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def current_non_admin_user(user: User = Depends(current_user)) -> User:
    if bool(getattr(user, "is_admin", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản admin không dùng được API người dùng",
        )
    return user


# ---------- Routes ----------
@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    """
    Đăng ký tài khoản mới.
    - Chuẩn hoá email → lowercase + strip
    - Bắt IntegrityError để xử lý race condition email trùng
    - Không cho tự đăng ký admin (is_admin = False theo default DB)
    """
    email_norm = payload.email  # đã được validator chuẩn hoá
    display_name = payload.display_name.strip()

    # Check nhanh (tránh query thừa nếu unique constraint đã có, nhưng giúp trả lỗi sớm/đẹp)
    if db.query(User).filter(User.email == email_norm).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email đã tồn tại")

    user = User(
        email=email_norm,
        display_name=display_name,
        password_hash=hash_password(payload.password),
        date_of_birth=payload.date_of_birth,
        # is_admin: để mặc định False (server_default ở model)
    )

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        # Trường hợp chạy song song: unique email vi phạm
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email đã tồn tại")

    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "is_admin": bool(getattr(user, "is_admin", False)),
        "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else None,
        "created_at": user.created_at.isoformat() if getattr(user, "created_at", None) else None,
    }


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    """
    Đăng nhập. Không tiết lộ chi tiết khi sai để tránh lộ dữ liệu.
    Trả về access_token kèm role/is_admin để FE điều hướng sang /admin nếu cần.
    """
    email_norm = payload.email  # đã được validator chuẩn hoá
    user = db.query(User).filter(User.email == email_norm).first()

    if not user or not verify_password(payload.password, user.password_hash):
        # Trả 401 chung chung
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai email hoặc mật khẩu")

    return _build_login_response(user)


@router.post("/admin/login")
def admin_login(payload: LoginIn, db: Session = Depends(get_db)):
    """
    Đăng nhập cho cổng quản trị.
    Chỉ tài khoản có is_admin=True mới được phép.
    """
    email_norm = payload.email
    user = db.query(User).filter(User.email == email_norm).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai email hoặc mật khẩu")

    if not bool(getattr(user, "is_admin", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ tài khoản admin mới đăng nhập được vào trang quản trị",
        )

    return _build_login_response(user)


@router.get("/me")
def me(user: User = Depends(current_user)):
    """
    Lấy thông tin người dùng hiện tại. Serialize datetime theo ISO.
    """
    role = "ADMIN" if bool(getattr(user, "is_admin", False)) else "USER"
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": getattr(user, "avatar_url", None),
        "role": role,
        "is_admin": role == "ADMIN",
        "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else None,
        "created_at": user.created_at.isoformat() if getattr(user, "created_at", None) else None,
    }
