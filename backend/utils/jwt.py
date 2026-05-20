import os, time, jwt
from dotenv import load_dotenv
load_dotenv()
SECRET = os.getenv("JWT_SECRET", "changeme")
ALGO = "HS256"
EXPIRE = 60*60*24*7  # 7 days
def create_token(payload: dict) -> str:
    to_encode = payload.copy(); to_encode.update({'exp': int(time.time()) + EXPIRE})
    return jwt.encode(to_encode, SECRET, algorithm=ALGO)
def decode_token(token: str):
    try: return jwt.decode(token, SECRET, algorithms=[ALGO])
    except Exception: return None
