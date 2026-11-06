"""Phone hashing, roster-name encryption, teacher tokens and one-time login codes."""
import base64
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from . import config

_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(("names:" + config.SECRET_KEY).encode()).digest()))
_tokens = URLSafeTimedSerializer(config.SECRET_KEY, salt="teacher-session")


def normalize_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def valid_phone(phone: str) -> bool:
    p = normalize_phone(phone)
    return len(p) == 10 and p[0] in "6789"


def phone_hash(phone: str) -> str:
    return hmac.new(config.SECRET_KEY.encode(), normalize_phone(phone).encode(), hashlib.sha256).hexdigest()


def encrypt_name(name: str) -> str:
    return _fernet.encrypt(name.encode()).decode()


def decrypt_name(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()


def make_token(teacher_id: str) -> str:
    return _tokens.dumps(teacher_id)


def read_token(token: str) -> str | None:
    try:
        return _tokens.loads(token, max_age=config.TOKEN_MAX_AGE_S)
    except (BadSignature, SignatureExpired):
        return None


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_hash(code: str) -> str:
    return hashlib.sha256(("code:" + config.SECRET_KEY + code).encode()).hexdigest()
