import fs from 'fs';
import type Database from 'better-sqlite3';

const FLAG = 'external_id_backfill_v1';
const BATCH = 2000;

interface PendingRow {
  id: number;
  source: string;
  session_id: string | null;
  recorded_at: string;
  raw_data: string | null;
}

/**
 * Derive the exact-dedup key for a row, matching what the collectors now write.
 * Claude Code: message.id + requestId (stable per API response).
 * Codex: session id + event timestamp (token_count events carry no id).
 */
function externalIdFor(row: PendingRow): string | null {
  if (row.source === 'codex') {
    return row.recorded_at ? `${row.session_id || ''}:${row.recorded_at}` : null;
  }

  if (!row.raw_data) return null;
  try {
    const entry = JSON.parse(row.raw_data) as {
      uuid?: string;
      requestId?: string;
      message?: { id?: string };
    };
    const messageId = entry.message?.id || entry.uuid || '';
    const requestId = entry.requestId || '';
    return messageId || requestId ? `${messageId}:${requestId}` : null;
  } catch {
    return null;
  }
}

/**
 * One-off backfill: give existing claude_code/codex rows the external_id that
 * the collectors now rely on, so dropping the timestamp watermark doesn't
 * re-insert history as duplicates.
 *
 * The watermark was a single global cursor, which meant a machine syncing for
 * the first time could never backfill data older than whatever the other
 * machines had already reported. Exact dedup removes that limit.
 *
 * Rows that collide on a key are duplicates the per-file dedup could not see
 * (the same message can appear in several session files after a resume/fork);
 * the oldest row wins and the rest are deleted, so totals may drop slightly
 * on first run. The DB is copied to <db>.bak-<timestamp> beforehand.
 */
export function backfillExternalIds(db: Database.Database, dbPath: string): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)');

  const done = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(FLAG);
  if (done) return;

  const markDone = (): void => {
    db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, datetime('now'))").run(FLAG);
  };

  const pending = db.prepare(`
    SELECT COUNT(*) AS n FROM usage_records
    WHERE external_id IS NULL AND source IN ('claude_code', 'claude_code_remote', 'codex')
  `).get() as { n: number };

  if (pending.n === 0) {
    markDone();
    return;
  }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (!fs.existsSync(backup)) {
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`[migrate] Backed up DB to ${backup}`);
  }

  // Uploads via /api/upload/claude landed under a separate source, so the same
  // message counted twice when the file also arrived by rsync. Same source now.
  const renamed = db.prepare(
    "UPDATE usage_records SET source = 'claude_code' WHERE source = 'claude_code_remote'"
  ).run();
  if (renamed.changes > 0) {
    console.log(`[migrate] Merged ${renamed.changes} claude_code_remote rows into claude_code`);
  }

  const selectBatch = db.prepare(`
    SELECT id, source, session_id, recorded_at, raw_data
    FROM usage_records
    WHERE id > ? AND external_id IS NULL AND source IN ('claude_code', 'codex')
    ORDER BY id LIMIT ${BATCH}
  `);
  const setExternalId = db.prepare('UPDATE usage_records SET external_id = ? WHERE id = ?');
  const deleteRow = db.prepare('DELETE FROM usage_records WHERE id = ?');

  let cursor = 0;
  let keyed = 0;
  let duplicates = 0;
  let skipped = 0;

  const processBatch = db.transaction((rows: PendingRow[]) => {
    for (const row of rows) {
      const externalId = externalIdFor(row);
      if (!externalId) {
        skipped++;
        continue;
      }
      try {
        setExternalId.run(externalId, row.id);
        keyed++;
      } catch {
        // UNIQUE(source, external_id) — an older row already owns this key.
        deleteRow.run(row.id);
        duplicates++;
      }
    }
  });

  for (;;) {
    const rows = selectBatch.all(cursor) as PendingRow[];
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    processBatch(rows);
  }

  markDone();
  console.log(
    `[migrate] external_id backfill: ${keyed} keyed, ${duplicates} duplicates removed, ${skipped} unkeyable`
  );
}
