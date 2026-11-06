# ruff: noqa: RUF001
"""Personal discussion sessions, scoped exclusively to the project wizard API."""

from __future__ import annotations

import asyncio
import secrets
import time
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict

from mindroom.api import config_lifecycle
from mindroom.api.auth import require_same_origin
from mindroom.constants import RuntimePaths  # noqa: TC001 - FastAPI resolves the dependency annotation
from mindroom.matrix_openid import MatrixOpenIDError, MatrixOpenIDToken, verify_matrix_openid
from mindroom.origins import normalized_origin
from mindroom.project_wizard.legacy_owners import migrate_standalone_drafts

router = APIRouter(prefix="/api/project-wizard/session", tags=["project-wizard"])
_COOKIE = "mindroom_discussion_session"
_COOKIE_PATH = "/api/project-wizard"
_SESSION_SECONDS = 3600
_SESSION_KEY = secrets.token_bytes(32)
_USER_HEADER = "X-MindRoom-Discussion-User"


class DiscussionSignIn(BaseModel):
    """A short-lived homeserver identity proof, never an account password."""

    model_config = ConfigDict(extra="forbid")
    openid_token: MatrixOpenIDToken


def discussion_paths(request: Request) -> RuntimePaths:
    """Require browser mutations to originate from this deployment."""
    paths = config_lifecycle.bind_current_request_snapshot(request).runtime_paths
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = normalized_origin(paths.env_value("MINDROOM_PUBLIC_URL")) or str(request.base_url).rstrip("/")
        require_same_origin(request, origin)
    return paths


async def require_discussion_user(request: Request, response: Response) -> dict[str, object]:
    """Authenticate personal APIs without granting dashboard/operator access."""
    discussion_paths(request)
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(_COOKIE)
    try:
        claims = jwt.decode(
            token or "",
            _SESSION_KEY,
            algorithms=["HS256"],
            audience="discussion",
            options={"require": ["sub", "exp", "aud"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "请登录后继续讨论。", headers={"Cache-Control": "no-store"}) from None
    user_id = claims["sub"]
    if request.headers.get(_USER_HEADER) != user_id:
        raise HTTPException(401, "账号已切换，请重新连接讨论。")
    return {"user_id": user_id, "matrix_user_id": user_id, "auth_source": "discussion"}


@router.post("")
async def sign_in(
    body: DiscussionSignIn,
    request: Request,
    response: Response,
    paths: Annotated[RuntimePaths, Depends(discussion_paths)],
) -> dict[str, str]:
    """Exchange a verified local Matrix identity for a personal discussion cookie."""
    try:
        user_id = await verify_matrix_openid(body.openid_token, paths)
    except MatrixOpenIDError as error:
        raise HTTPException(error.status_code, error.detail) from None
    if request.headers.get(_USER_HEADER) != user_id:
        raise HTTPException(401, "登录账号与讨论账号不一致。")
    await asyncio.to_thread(
        migrate_standalone_drafts,
        paths.storage_root,
        user_id,
        paths.env_value("MINDROOM_OWNER_USER_ID"),
    )
    token = jwt.encode(
        {"sub": user_id, "exp": int(time.time()) + _SESSION_SECONDS, "aud": "discussion"},
        _SESSION_KEY,
        algorithm="HS256",
    )
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        _COOKIE,
        token,
        max_age=_SESSION_SECONDS,
        path=_COOKIE_PATH,
        secure=(normalized_origin(paths.env_value("MINDROOM_PUBLIC_URL")) or str(request.base_url)).startswith("https://"),
        httponly=True,
        samesite="strict",
    )
    return {"matrix_user_id": user_id}


@router.get("")
async def current_session(
    response: Response,
    user: Annotated[dict, Depends(require_discussion_user)],
) -> dict[str, str]:
    """Check that the discussion cookie belongs to the displayed Matrix account."""
    response.headers["Cache-Control"] = "no-store"
    return {"matrix_user_id": user["matrix_user_id"]}


@router.delete("", dependencies=[Depends(discussion_paths)])
async def sign_out(response: Response) -> dict[str, bool]:
    """Forget the discussion cookie independently of operator authentication."""
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(_COOKIE, path=_COOKIE_PATH)
    return {"success": True}
