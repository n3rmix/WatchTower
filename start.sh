#!/usr/bin/env bash
# start.sh — Start WatchTower backend as a background daemon.
# Frontend is served by nginx. Survives SSH session termination.
# Safe to run again (skips if already running).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$SCRIPT_DIR/logs"
PIDS_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$LOGS_DIR" "$PIDS_DIR"

is_running() {
  local pidfile="$PIDS_DIR/$1.pid"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

# ── Backend ────────────────────────────────────────────────────────────────────

if is_running backend; then
  echo "backend: already running (PID $(cat "$PIDS_DIR/backend.pid"))"
else
  if [ ! -d "$SCRIPT_DIR/backend/venv" ]; then
    echo "ERROR: backend/venv not found."
    echo "       Run: cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
  fi

  (
    cd "$SCRIPT_DIR/backend"
    source venv/bin/activate
    # Python 3.14 / OpenSSL 3.4+ ships X25519MLKEM768 (post-quantum) in the
    # TLS 1.3 ClientHello, which Atlas rejects with INTERNAL_ERROR.
    # This config restricts groups to the classical set. MUST be set before
    # Python starts (OpenSSL reads config at library init).
    export OPENSSL_CONF="$SCRIPT_DIR/backend/openssl_atlas.cnf"
    nohup python -m uvicorn server:app \
      --host 127.0.0.1 --port 8001 \
      >> "$LOGS_DIR/backend.log" 2>&1 &
    echo $! > "$PIDS_DIR/backend.pid"
  )
  echo "backend: started (PID $(cat "$PIDS_DIR/backend.pid"))  →  logs/backend.log"
fi

# ── Done ───────────────────────────────────────────────────────────────────────

echo ""
echo "WatchTower backend is running:"
echo "  API (internal)  →  http://127.0.0.1:8001"
echo "  API docs        →  http://127.0.0.1:8001/docs"
echo "  Frontend        →  served by nginx"
echo ""
echo "Useful commands:"
echo "  ./stop.sh                   stop the backend"
echo "  tail -f logs/backend.log    live backend logs"
