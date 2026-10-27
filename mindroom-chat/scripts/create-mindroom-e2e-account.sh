#!/usr/bin/env bash

set -euo pipefail

SSH_HOST="${MINDROOM_SSH_HOST:-mindroom}"
REMOTE_CONFIG_PATH="${MINDROOM_REMOTE_CONFIG_PATH:-/run/tuwunel/tuwunel.toml}"
REMOTE_BASE_URL="${MINDROOM_REMOTE_BASE_URL:-http://localhost:8008}"
VAR_PREFIX="${1:-E2E}"

USERNAME="${E2E_ACCOUNT_USERNAME:-codexe2e$(date +%s)$(python3 - <<'PY'
import secrets
print(secrets.token_hex(2))
PY
)}"
PASSWORD="${E2E_ACCOUNT_PASSWORD:-$(python3 - <<'PY'
import secrets
print("Pw" + secrets.token_hex(12) + "!")
PY
)}"

ssh "${SSH_HOST}" "sudo USERNAME='${USERNAME}' PASSWORD='${PASSWORD}' REMOTE_CONFIG_PATH='${REMOTE_CONFIG_PATH}' REMOTE_BASE_URL='${REMOTE_BASE_URL}' python3 - <<\"PY\"
import json
import os
import re
import urllib.request
from pathlib import Path

config = Path(os.environ['REMOTE_CONFIG_PATH']).read_text()
match = re.search(r'registration_token_file\\s*=\\s*\"([^\"]+)\"', config)
if not match:
    raise SystemExit('registration token file not found')

token = Path(match.group(1)).read_text().strip()
username = os.environ['USERNAME']
password = os.environ['PASSWORD']
base = os.environ['REMOTE_BASE_URL'].rstrip('/') + '/_matrix/client/v3/register'

initial = {
    'username': username,
    'password': password,
    'initial_device_display_name': 'Codex E2E',
}

request = urllib.request.Request(
    base,
    data=json.dumps(initial).encode(),
    headers={'Content-Type': 'application/json'},
)

try:
    urllib.request.urlopen(request)
    raise SystemExit('unexpected success without registration token')
except urllib.error.HTTPError as exc:
    if exc.code != 401:
        raise
    challenge = json.loads(exc.read().decode())

final_payload = {
    **initial,
    'auth': {
        'type': 'm.login.registration_token',
        'session': challenge['session'],
        'token': token,
    },
}

request = urllib.request.Request(
    base,
    data=json.dumps(final_payload).encode(),
    headers={'Content-Type': 'application/json'},
)
with urllib.request.urlopen(request) as response:
    if response.status != 200:
        raise SystemExit(f'unexpected status {response.status}')
PY"

printf 'export %s_USERNAME=%q\n' "${VAR_PREFIX}" "${USERNAME}"
printf 'export %s_PASSWORD=%q\n' "${VAR_PREFIX}" "${PASSWORD}"
