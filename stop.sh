#!/usr/bin/env bash
# stop.sh — Stop WatchTower background daemons.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_DIR="$SCRIPT_DIR/.pids"

# Recursively kill a process and all its descendants (leaves first).
# Usage: kill_tree <pid> [signal]
kill_tree() {
  local pid="$1" sig="${2:-TERM}"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

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
    # Gracefully terminate the whole process tree
    kill_tree "$pid" TERM
    # Wait up to 5 s for the root process to exit
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    # Force-kill anything still alive
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid" KILL
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
