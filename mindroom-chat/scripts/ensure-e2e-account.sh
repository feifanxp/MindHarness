#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <var-prefix> <default-username> <default-password>" >&2
  exit 64
fi

VAR_PREFIX="$1"
DEFAULT_USERNAME="$2"
DEFAULT_PASSWORD="$3"
MATRIX_PORT="${E2E_MATRIX_PORT:-28008}"
HOMESERVER_URL="${E2E_HOMESERVER:-http://127.0.0.1:${MATRIX_PORT}}"

USERNAME_VAR="${VAR_PREFIX}_USERNAME"
PASSWORD_VAR="${VAR_PREFIX}_PASSWORD"
USERNAME="${!USERNAME_VAR:-${DEFAULT_USERNAME}}"
PASSWORD="${!PASSWORD_VAR:-${DEFAULT_PASSWORD}}"

python3 - "${HOMESERVER_URL}" "${USERNAME}" "${PASSWORD}" <<'PY'
import json
import sys
import urllib.error
import urllib.request

base, username, password = sys.argv[1:4]
base = base.rstrip("/")


class MatrixError(Exception):
    def __init__(self, status, payload):
        super().__init__(payload.get("error") or payload.get("errcode") or f"HTTP {status}")
        self.status = status
        self.payload = payload


def request(path, payload):
    req = urllib.request.Request(
        f"{base}/_matrix/client/v3{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode())
        except json.JSONDecodeError:
            payload = {"error": exc.reason, "errcode": f"HTTP_{exc.code}"}
        raise MatrixError(exc.code, payload) from exc


def login():
    return request(
        "/login",
        {
            "type": "m.login.password",
            "identifier": {"type": "m.id.user", "user": username},
            "password": password,
            "initial_device_display_name": "MindRoom Chat E2E",
        },
    )


def register():
    initial = {
        "username": username,
        "password": password,
        "initial_device_display_name": "MindRoom Chat E2E",
    }

    try:
        return request("/register", initial)
    except MatrixError as exc:
        if exc.payload.get("errcode") == "M_USER_IN_USE":
            return login()
        if exc.status != 401:
            raise

        session = exc.payload.get("session")
        flows = exc.payload.get("flows") or []
        if not session:
            raise

        auth_type = None
        for flow in flows:
            stages = flow.get("stages") or []
            if "m.login.dummy" in stages:
                auth_type = "m.login.dummy"
                break
        if auth_type is None:
            raise SystemExit(f"Unsupported registration flows for local e2e stack: {flows!r}")

        return request(
            "/register",
            {
                **initial,
                "auth": {
                    "type": auth_type,
                    "session": session,
                },
            },
        )


try:
    login()
except MatrixError:
    register()
PY

printf 'export %s_USERNAME=%q\n' "${VAR_PREFIX}" "${USERNAME}"
printf 'export %s_PASSWORD=%q\n' "${VAR_PREFIX}" "${PASSWORD}"
