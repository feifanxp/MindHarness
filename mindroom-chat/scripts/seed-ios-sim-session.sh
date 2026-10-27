#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
usage: seed-ios-sim-session.sh [--bundle-id <id>] [--restore-path <mode>] [--clear-indexeddb] [--alias-paths]

Seed the booted iOS simulator app container with a local Matrix session and a saved thread route.

Options:
  --bundle-id <id>        App bundle id. Default: chat.mindroom.app
  --restore-path <mode>   One of:
                            thread     -> saved thread route
                            room       -> saved /home room route + lastOpenThread
                            space-room -> saved /space/room route + lastOpenThread
                          Default: thread
  --clear-indexeddb       Delete WebKit IndexedDB before launch to simulate a colder restore.
  --alias-paths           Store the saved route with canonical aliases instead of room IDs.
  -h, --help              Show this help text.

Environment overrides:
  E2E_HOMESERVER          Homeserver URL. Default: http://127.0.0.1:28008
  E2E_MATRIX_PORT         Homeserver port when E2E_HOMESERVER is unset. Default: 28008
  IOSSIM_USERNAME         Matrix username. Default: cinnye2eiossim
  IOSSIM_PASSWORD         Matrix password. Default: Pwcinnye2eiossim123!
EOF
}

BUNDLE_ID="chat.mindroom.app"
RESTORE_PATH_MODE="thread"
CLEAR_INDEXEDDB=0
ALIAS_PATHS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle-id)
      BUNDLE_ID="$2"
      shift 2
      ;;
    --restore-path)
      RESTORE_PATH_MODE="$2"
      shift 2
      ;;
    --clear-indexeddb)
      CLEAR_INDEXEDDB=1
      shift
      ;;
    --alias-paths)
      ALIAS_PATHS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

case "$RESTORE_PATH_MODE" in
  thread|room|space-room) ;;
  *)
    echo "Invalid --restore-path: $RESTORE_PATH_MODE" >&2
    exit 64
    ;;
esac

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOMESERVER_URL="${E2E_HOMESERVER:-http://127.0.0.1:${E2E_MATRIX_PORT:-28008}}"
IOSSIM_USERNAME="${IOSSIM_USERNAME:-cinnye2eiossim}"
IOSSIM_PASSWORD="${IOSSIM_PASSWORD:-Pwcinnye2eiossim123!}"

"${ROOT_DIR}/scripts/e2e-matrix-up.sh" >/dev/null
"${ROOT_DIR}/scripts/ensure-e2e-account.sh" IOSSIM "${IOSSIM_USERNAME}" "${IOSSIM_PASSWORD}" >/dev/null

python3 - "${BUNDLE_ID}" "${HOMESERVER_URL}" "${IOSSIM_USERNAME}" "${IOSSIM_PASSWORD}" "${RESTORE_PATH_MODE}" "${CLEAR_INDEXEDDB}" "${ALIAS_PATHS}" <<'PY'
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request

bundle_id, homeserver, username, password, restore_mode, clear_indexeddb, alias_paths = sys.argv[1:8]
clear_indexeddb = clear_indexeddb == "1"
alias_paths = alias_paths == "1"


def request(path: str, *, method: str = "GET", access_token: str | None = None, body=None):
    req = urllib.request.Request(f"{homeserver}/_matrix/client/v3{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if access_token:
        req.add_header("Authorization", f"Bearer {access_token}")
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=20) as response:
        return json.loads(response.read().decode())


login = request(
    "/login",
    method="POST",
    body={
        "type": "m.login.password",
        "identifier": {"type": "m.id.user", "user": username},
        "password": password,
        "initial_device_display_name": "MindRoom Chat iOS Sim",
    },
)

access_token = login["access_token"]
user_id = login["user_id"]
device_id = login["device_id"]
base_url = homeserver.rstrip("/")

stamp = int(time.time())
space_alias_localpart = f"ios-sim-space-{stamp}"
room_alias_localpart = f"ios-sim-room-{stamp}"

space_id = request(
    "/createRoom",
    method="POST",
    access_token=access_token,
    body={
        "name": "iOS Sim Space",
        "topic": "Native cold-start repro",
        "preset": "private_chat",
        "creation_content": {"type": "m.space"},
        "room_alias_name": space_alias_localpart,
    },
)["room_id"]

room_id = request(
    "/createRoom",
    method="POST",
    access_token=access_token,
    body={
        "name": "iOS Sim Room",
        "topic": "Native cold-start repro room",
        "preset": "private_chat",
        "room_alias_name": room_alias_localpart,
    },
)["room_id"]

space_alias = f"#{space_alias_localpart}:matrix.localhost"
room_alias = f"#{room_alias_localpart}:matrix.localhost"

via = urllib.parse.urlparse(homeserver).netloc
space_link = {"via": [via]}
request(
    f"/rooms/{urllib.parse.quote(space_id, safe='')}/state/{urllib.parse.quote('m.space.child', safe='')}/{urllib.parse.quote(room_id, safe='')}",
    method="PUT",
    access_token=access_token,
    body=space_link,
)
request(
    f"/rooms/{urllib.parse.quote(room_id, safe='')}/state/{urllib.parse.quote('m.space.parent', safe='')}/{urllib.parse.quote(space_id, safe='')}",
    method="PUT",
    access_token=access_token,
    body=space_link,
)

txn_prefix = f"ios-sim-{int(time.time())}"


def send_message(content, suffix):
    response = request(
        f"/rooms/{urllib.parse.quote(room_id, safe='')}/send/m.room.message/{txn_prefix}-{suffix}",
        method="PUT",
        access_token=access_token,
        body=content,
    )
    return response["event_id"]


root_id = send_message({"msgtype": "m.text", "body": "iOS simulator startup root"}, "root")
reply_1 = send_message(
    {
        "msgtype": "m.text",
        "body": "iOS simulator startup reply 1",
        "m.relates_to": {
            "rel_type": "m.thread",
            "event_id": root_id,
            "is_falling_back": True,
            "m.in_reply_to": {"event_id": root_id},
        },
    },
    "reply1",
)
reply_2 = send_message(
    {
        "msgtype": "m.text",
        "body": "iOS simulator startup reply 2",
        "m.relates_to": {
            "rel_type": "m.thread",
            "event_id": root_id,
            "is_falling_back": True,
            "m.in_reply_to": {"event_id": root_id},
        },
    },
    "reply2",
)

app_data = subprocess.check_output(
    ["xcrun", "simctl", "get_app_container", "booted", bundle_id, "data"], text=True
).strip()

webkit_root = os.path.join(app_data, "Library", "WebKit", bundle_id, "WebsiteData", "Default")
localstorage_db = None
indexeddb_root = None

for current_root, dirs, files in os.walk(webkit_root):
    if indexeddb_root is None and os.path.basename(current_root) == "IndexedDB":
        indexeddb_root = current_root
    if localstorage_db is None and "localstorage.sqlite3" in files:
        localstorage_db = os.path.join(current_root, "localstorage.sqlite3")

if localstorage_db is None:
    raise SystemExit("Could not find simulator localstorage.sqlite3")

if clear_indexeddb and indexeddb_root and os.path.isdir(indexeddb_root):
    for current_root, dirs, files in os.walk(indexeddb_root, topdown=False):
        for filename in files:
            os.remove(os.path.join(current_root, filename))
        for dirname in dirs:
            os.rmdir(os.path.join(current_root, dirname))

session_id = (
    urllib.parse.quote(base_url, safe="")
    + "::"
    + urllib.parse.quote(user_id, safe="")
)

space_route = urllib.parse.quote(space_alias if alias_paths else space_id, safe="")
room_route = urllib.parse.quote(room_alias if alias_paths else room_id, safe="")

if restore_mode == "thread":
    last_known_path = (
        "/"
        + space_route
        + "/"
        + room_route
        + "?threadId="
        + urllib.parse.quote(root_id, safe="")
    )
elif restore_mode == "room":
    last_known_path = "/home/" + room_route
else:
    last_known_path = (
        "/"
        + space_route
        + "/"
        + room_route
    )

session_store = {
    "version": 1,
    "activeSessionId": session_id,
    "sessions": [
        {
            "sessionId": session_id,
            "baseUrl": base_url,
            "userId": user_id,
            "deviceId": device_id,
            "accessToken": access_token,
            "lastUsedAt": int(time.time() * 1000),
            "lastKnownPath": last_known_path,
        }
    ],
}

entries = {
    "mindroom_multi_account_store": json.dumps(session_store, separators=(",", ":")),
    f"lastOpenThread{user_id}": json.dumps({room_id: root_id}, separators=(",", ":")),
    f"roomViewMode:{room_id}": json.dumps("compact"),
}

conn = sqlite3.connect(localstorage_db)
try:
    conn.execute("PRAGMA journal_mode=WAL;")
    for key, value in entries.items():
        conn.execute(
            "INSERT OR REPLACE INTO ItemTable(key, value) VALUES (?, ?)",
            (key, value.encode("utf-16le")),
        )
    conn.commit()
finally:
    conn.close()

print(
    json.dumps(
        {
            "bundle_id": bundle_id,
            "homeserver": base_url,
            "app_data": app_data,
            "localstorage_db": localstorage_db,
            "user_id": user_id,
            "device_id": device_id,
        "space_id": space_id,
        "space_alias": space_alias,
        "room_id": room_id,
        "room_alias": room_alias,
        "thread_root_id": root_id,
            "reply_ids": [reply_1, reply_2],
        "restore_mode": restore_mode,
        "alias_paths": alias_paths,
        "last_known_path": last_known_path,
            "indexeddb_cleared": clear_indexeddb,
        },
        indent=2,
    )
)
PY
