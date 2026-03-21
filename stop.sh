#!/usr/bin/env bash
# stop.sh — Stop WatchTower background daemons.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_DIR="$SCRIPT_DIR/.pids"

stop_process() {
  local name="$1"
  local pidfile="$PIDS_DIR/$name.pid"

  if [ ! -f "$pidfile" ]; then
    echo "$name: not running"
    return
  fi

  local pid
  pid=$(cat "$pidfile")

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    # Wait up to 5 s for the process to exit
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid"
      echo "$name: force-killed (PID $pid)"
    else
      echo "$name: stopped   (PID $pid)"
    fi
  else
    echo "$name: already stopped"
  fi

  rm -f "$pidfile"
}

stop_process backend
stop_process frontend
