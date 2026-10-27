#!/usr/bin/env bash

# Start Agent Room's MindRoom Chat-based frontend
# Usage: ./run-frontend.sh [dev|prod]

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if ! command -v npm &> /dev/null; then
  echo "❌ npm not found. Install Node.js 18 or newer."
  exit 1
fi

cd "$SCRIPT_DIR/mindroom-chat"
npm ci

if [ "${1:-dev}" = "prod" ] || [ "$1" = "production" ]; then
  npm run build
  exec npm run preview -- --host 0.0.0.0 --port 3003
else
  exec npm start -- --host 0.0.0.0 --port 3003
fi
