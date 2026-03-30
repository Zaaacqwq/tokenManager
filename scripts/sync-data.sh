#!/bin/bash
# Sync local Claude Code + Codex session data to VPS
# Usage: ./scripts/sync-data.sh
# Cron: */10 * * * * /Users/zaaac/Documents/Code/tokenManager/scripts/sync-data.sh

set -euo pipefail

VPS="root@198.98.53.225"
REMOTE_DATA="/opt/token-manager-data"

echo "[$(date)] Starting data sync..."

# Ensure remote dirs exist
ssh "$VPS" "mkdir -p ${REMOTE_DATA}/claude-projects ${REMOTE_DATA}/codex-sessions ${REMOTE_DATA}/openclaw-agents"

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

echo "[$(date)] Done"
