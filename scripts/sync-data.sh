#!/bin/bash
# Sync local Claude Code + Codex session data to VPS
# Usage: ./scripts/sync-data.sh
# Cron: */10 * * * * /Users/zaaac/Documents/Code/tokenManager/scripts/sync-data.sh

set -euo pipefail

VPS="root@198.98.53.225"
REMOTE_DATA="/opt/token-manager-data"

echo "[$(date)] Starting data sync..."

# Ensure remote dirs exist
ssh "$VPS" "mkdir -p ${REMOTE_DATA}/claude-projects ${REMOTE_DATA}/codex-sessions ${REMOTE_DATA}/openclaw-agents ${REMOTE_DATA}/opencode ${REMOTE_DATA}/antigravity-conversations"

# Sync Claude Code sessions (only JSONL files, skip large binary data)
rsync -az --include='*/' --include='*.jsonl' --exclude='*' \
  ~/.claude/projects/ "${VPS}:${REMOTE_DATA}/claude-projects/" 2>&1

echo "[$(date)] Claude Code synced"

# Sync Codex sessions
rsync -az --include='*/' --include='*.jsonl' --exclude='*' \
  ~/.codex/sessions/ "${VPS}:${REMOTE_DATA}/codex-sessions/" 2>&1

echo "[$(date)] Codex synced"

# Sync OpenClaw sessions
if [ -d ~/.openclaw/agents ]; then
  rsync -az --include='*/' --include='*.jsonl' --exclude='*' \
    ~/.openclaw/agents/ "${VPS}:${REMOTE_DATA}/openclaw-agents/" 2>&1
  echo "[$(date)] OpenClaw synced"
fi

# Sync OpenCode DB (use sqlite .backup for a consistent snapshot — the live
# DB is in WAL mode and may be mid-write)
if [ -f ~/.local/share/opencode/opencode.db ]; then
  TMP_OC=$(mktemp -d)
  sqlite3 ~/.local/share/opencode/opencode.db ".backup ${TMP_OC}/opencode.db"
  rsync -az "${TMP_OC}/opencode.db" "${VPS}:${REMOTE_DATA}/opencode/opencode.db"
  rm -rf "$TMP_OC"
  echo "[$(date)] OpenCode synced"
fi

# Sync Antigravity CLI conversation DBs (same consistent-snapshot treatment)
if [ -d ~/.gemini/antigravity-cli/conversations ]; then
  TMP_AG=$(mktemp -d)
  for f in ~/.gemini/antigravity-cli/conversations/*.db; do
    [ -f "$f" ] || continue
    sqlite3 "$f" ".backup ${TMP_AG}/$(basename "$f")" 2>/dev/null || true
  done
  rsync -az "${TMP_AG}/" "${VPS}:${REMOTE_DATA}/antigravity-conversations/"
  rm -rf "$TMP_AG"
  echo "[$(date)] Antigravity synced"
fi

echo "[$(date)] Done"
