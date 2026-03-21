#!/usr/bin/env bash
# start.sh — Start WatchTower backend and frontend as background daemons.
# Survives SSH session termination. Safe to run again (skips already-running processes).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$SCRIPT_DIR/logs"
PIDS_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$LOGS_DIR" "$PIDS_DIR"

# ── helpers ────────────────────────────────────────────────────────────────────

is_running() {
  local pidfile="$PIDS_DIR/$1.pid"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

# ── Backend ────────────────────────────────────────────────────────────────────

if is_running backend; then
  echo "backend:  already running (PID $(cat "$PIDS_DIR/backend.pid"))"
else
  if [ ! -d "$SCRIPT_DIR/backend/venv" ]; then
    echo "ERROR: backend/venv not found."
    echo "       Run: cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
  fi

  (
    cd "$SCRIPT_DIR/backend"
    source venv/bin/activate
    nohup python -m uvicorn server:app \
      --host 0.0.0.0 --port 8001 \
      >> "$LOGS_DIR/backend.log" 2>&1 &
    echo $! > "$PIDS_DIR/backend.pid"
  )
  echo "backend:  started  (PID $(cat "$PIDS_DIR/backend.pid"))  →  logs/backend.log"
fi

# ── Frontend ───────────────────────────────────────────────────────────────────

if is_running frontend; then
  echo "frontend: already running (PID $(cat "$PIDS_DIR/frontend.pid"))"
else
  if [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
    echo "ERROR: frontend/node_modules not found."
    echo "       Run: cd frontend && yarn install"
    exit 1
  fi

  (
    cd "$SCRIPT_DIR/frontend"
    # BROWSER=none prevents the dev server from opening a browser tab
    nohup env BROWSER=none yarn start \
      >> "$LOGS_DIR/frontend.log" 2>&1 &
    echo $! > "$PIDS_DIR/frontend.pid"
  )
  echo "frontend: started  (PID $(cat "$PIDS_DIR/frontend.pid"))  →  logs/frontend.log"
fi

# ── Done ───────────────────────────────────────────────────────────────────────

echo ""
echo "WatchTower is running:"
echo "  Frontend  →  http://localhost:3000"
echo "  Backend   →  http://localhost:8001"
echo "  API docs  →  http://localhost:8001/docs"
echo ""
echo "Useful commands:"
echo "  ./stop.sh                     stop everything"
echo "  tail -f logs/backend.log      live backend logs"
echo "  tail -f logs/frontend.log     live frontend logs"
