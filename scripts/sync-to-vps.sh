#!/bin/bash
# Sync Claude Code session data from local Mac to Token Manager VPS
# Usage: ./sync-to-vps.sh
# Set up as cron: */30 * * * * /path/to/sync-to-vps.sh

set -euo pipefail

SERVER_URL="${TOKEN_MANAGER_URL:-https://token.zaaac.vip}"
ADMIN_USER="${TOKEN_MANAGER_USER:-admin}"
ADMIN_PASS="${TOKEN_MANAGER_PASS:-tokenmanager2026}"
CLAUDE_PROJECTS="${HOME}/.claude/projects"
STATE_FILE="${HOME}/.claude/metrics/sync_state.json"

# Ensure state dir exists
mkdir -p "$(dirname "$STATE_FILE")"

# Get last sync timestamp
LAST_SYNC="1970-01-01T00:00:00.000Z"
if [ -f "$STATE_FILE" ]; then
  LAST_SYNC=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('last_sync', '$LAST_SYNC'))")
fi

echo "[sync] Last sync: $LAST_SYNC"

# Login to get token
TOKEN=$(curl -sf "${SERVER_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

if [ -z "$TOKEN" ]; then
  echo "[sync] Login failed"
  exit 1
fi

echo "[sync] Logged in successfully"

# Extract usage lines from all session JSONL files, filter by timestamp
LINES=$(find "$CLAUDE_PROJECTS" -name '*.jsonl' -exec python3 -c "
import json, sys

last_sync = '$LAST_SYNC'
results = []

for filepath in sys.argv[1:]:
    try:
        with open(filepath) as f:
            for line in f:
                try:
                    d = json.loads(line.strip())
                    ts = d.get('timestamp', '')
                    msg = d.get('message', {})
                    usage = msg.get('usage', {})
                    if (msg.get('role') == 'assistant' and
                        ts > last_sync and
                        (usage.get('input_tokens') or usage.get('output_tokens') or
                         usage.get('cache_read_input_tokens') or usage.get('cache_creation_input_tokens'))):
                        results.append(line.strip())
                except:
                    pass
    except:
        pass

# Output as JSON array
print(json.dumps(results))
" {} +)

COUNT=$(echo "$LINES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
echo "[sync] Found $COUNT new usage records"

if [ "$COUNT" -eq 0 ]; then
  echo "[sync] Nothing to sync"
  exit 0
fi

# Upload to server
RESULT=$(echo "$LINES" | curl -sf "${SERVER_URL}/api/upload/claude" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"lines\": $(cat)}")

echo "[sync] Upload result: $RESULT"

# Update state with current timestamp
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
echo "{\"last_sync\": \"$NOW\"}" > "$STATE_FILE"
echo "[sync] State updated to $NOW"
