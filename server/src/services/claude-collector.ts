import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { getModelPrices, calculateCost } from './pricing.js';

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface SessionMessage {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  uuid?: string;
  requestId?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    usage?: ClaudeUsage;
  };
}

/** Deduped record keyed by messageId:requestId */
interface DedupedRecord {
  messageId: string;
  requestId: string;
  sessionId: string;
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreate: number;
  rawLine: string;
}

function resolveHome(filepath: string): string {
  return filepath.startsWith('~')
    ? path.join(process.env.HOME || '', filepath.slice(1))
    : filepath;
}

/**
 * Parse a JSONL file and return deduplicated usage records.
 * Claude Code streaming creates multiple entries with the same message.id + requestId.
 * We keep only the entry with the highest output_tokens per group (the final count).
 */
function parseDedupedRecords(
  file: string,
  lastTimestamp: string
): DedupedRecord[] {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Group by composite key: messageId:requestId
  const groups = new Map<string, DedupedRecord>();

  for (const line of lines) {
    try {
      const entry: SessionMessage = JSON.parse(line);

      const usage = entry.message?.usage;
      if (!usage || entry.message?.role !== 'assistant') continue;
      if (
        !usage.input_tokens &&
        !usage.output_tokens &&
        !usage.cache_read_input_tokens &&
        !usage.cache_creation_input_tokens
      ) continue;

      const ts = entry.timestamp || '';
      if (ts <= lastTimestamp) continue;

      const messageId = entry.message?.id || entry.uuid || '';
      const requestId = entry.requestId || '';
      const dedupKey = `${messageId}:${requestId}`;

      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;

      const existing = groups.get(dedupKey);
      if (existing) {
        // Keep the record with highest output_tokens (final streaming value)
        if (outputTokens > existing.outputTokens) {
          existing.outputTokens = outputTokens;
          existing.inputTokens = inputTokens;
          existing.cacheRead = cacheRead;
          existing.cacheCreate = cacheCreate;
          existing.timestamp = ts;
          existing.rawLine = line;
        }
      } else {
        groups.set(dedupKey, {
          messageId,
          requestId,
          sessionId: entry.sessionId || '',
          model: entry.message?.model || 'unknown',
          timestamp: ts,
          inputTokens,
          outputTokens,
          cacheRead,
          cacheCreate,
          rawLine: line,
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  return Array.from(groups.values());
}

/**
 * Sync from Claude Code session JSONL files in ~/.claude/projects/
 * Deduplicates streaming responses using message.id + requestId composite key.
 */
export function syncClaudeCode(): { synced: number; errors: number } {
  const projectsDir = resolveHome(
    process.env.CLAUDE_PROJECTS_PATH || '~/.claude/projects'
  );

  if (!fs.existsSync(projectsDir)) {
    return { synced: 0, errors: 0 };
  }

  const db = getDb();

  // Find or create Anthropic provider
  let provider = db.prepare(
    "SELECT id FROM providers WHERE type = 'anthropic' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (!provider) {
    const result = db.prepare(
      "INSERT INTO providers (name, type) VALUES ('Anthropic', 'anthropic')"
    ).run();
    provider = { id: result.lastInsertRowid as number };
  }

  // Get sync state
  const syncState = db.prepare(
    'SELECT last_timestamp FROM sync_state WHERE source = ?'
  ).get('claude_code') as { last_timestamp: string } | undefined;

  const lastTimestamp = syncState?.last_timestamp || '1970-01-01T00:00:00.000Z';

  const jsonlFiles = findJsonlFiles(projectsDir);

  const insertRecord = db.prepare(`
    INSERT INTO usage_records (provider_id, model_id, source, session_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'claude_code', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findModel = db.prepare(
    'SELECT id FROM models WHERE provider_id = ? AND name = ?'
  );

  const insertModel = db.prepare(
    'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
  );

  let synced = 0;
  let errors = 0;
  let latestTs = lastTimestamp;

  db.transaction(() => {
    for (const file of jsonlFiles) {
      try {
        const records = parseDedupedRecords(file, lastTimestamp);

        for (const record of records) {
          try {
            // Resolve model
            let model = findModel.get(provider!.id, record.model) as { id: number } | undefined;
            if (!model) {
              const prices = getModelPrices(record.model);
              const result = insertModel.run(
                provider!.id, record.model,
                prices.input, prices.output,
                prices.cacheRead, prices.cacheWrite
              );
              model = { id: result.lastInsertRowid as number };
            }

            const cost = calculateCost(
              record.model, record.inputTokens, record.outputTokens,
              record.cacheRead, record.cacheCreate
            );

            insertRecord.run(
              provider!.id,
              model.id,
              record.sessionId || null,
              record.inputTokens,
              record.outputTokens,
              record.cacheRead,
              record.cacheCreate,
              cost,
              record.timestamp,
              record.rawLine
            );
            synced++;

            if (record.timestamp > latestTs) latestTs = record.timestamp;
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
      }
    }

    // Update sync state
    if (latestTs > lastTimestamp) {
      db.prepare(`
        INSERT INTO sync_state (source, last_timestamp, updated_at)
        VALUES ('claude_code', ?, datetime('now'))
        ON CONFLICT(source) DO UPDATE SET
          last_timestamp = excluded.last_timestamp,
          updated_at = datetime('now')
      `).run(latestTs);
    }
  })();

  return { synced, errors };
}

/**
 * Sync from uploaded JSONL data (from remote machines).
 * Also deduplicates streaming responses.
 */
export function syncClaudeFromUpload(lines: string[]): { synced: number; errors: number } {
  const db = getDb();

  let provider = db.prepare(
    "SELECT id FROM providers WHERE type = 'anthropic' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (!provider) {
    const result = db.prepare(
      "INSERT INTO providers (name, type) VALUES ('Anthropic', 'anthropic')"
    ).run();
    provider = { id: result.lastInsertRowid as number };
  }

  // First, deduplicate the uploaded lines in-memory
  const groups = new Map<string, DedupedRecord>();

  for (const line of lines) {
    try {
      const entry: SessionMessage = JSON.parse(line);
      const usage = entry.message?.usage;
      if (!usage || entry.message?.role !== 'assistant') continue;
      if (
        !usage.input_tokens &&
        !usage.output_tokens &&
        !usage.cache_read_input_tokens &&
        !usage.cache_creation_input_tokens
      ) continue;

      const messageId = entry.message?.id || entry.uuid || '';
      const requestId = entry.requestId || '';
      const dedupKey = `${messageId}:${requestId}`;

      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;

      const existing = groups.get(dedupKey);
      if (existing) {
        if (outputTokens > existing.outputTokens) {
          existing.outputTokens = outputTokens;
          existing.inputTokens = inputTokens;
          existing.cacheRead = cacheRead;
          existing.cacheCreate = cacheCreate;
          existing.timestamp = entry.timestamp || '';
          existing.rawLine = line;
        }
      } else {
        groups.set(dedupKey, {
          messageId,
          requestId,
          sessionId: entry.sessionId || '',
          model: entry.message?.model || 'unknown',
          timestamp: entry.timestamp || '',
          inputTokens,
          outputTokens,
          cacheRead,
          cacheCreate,
          rawLine: line,
        });
      }
    } catch {
      // skip
    }
  }

  const checkExisting = db.prepare(
    "SELECT id FROM usage_records WHERE source = 'claude_code_remote' AND recorded_at = ? AND session_id = ? AND input_tokens = ? AND output_tokens = ? LIMIT 1"
  );

  const insertRecord = db.prepare(`
    INSERT INTO usage_records (provider_id, model_id, source, session_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'claude_code_remote', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findModel = db.prepare(
    'SELECT id FROM models WHERE provider_id = ? AND name = ?'
  );

  const insertModel = db.prepare(
    'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
  );

  let synced = 0;
  let errors = 0;

  db.transaction(() => {
    for (const record of groups.values()) {
      try {
        // DB-level dedup check
        const existing = checkExisting.get(
          record.timestamp, record.sessionId, record.inputTokens, record.outputTokens
        );
        if (existing) continue;

        let model = findModel.get(provider!.id, record.model) as { id: number } | undefined;
        if (!model) {
          const prices = getModelPrices(record.model);
          const result = insertModel.run(
            provider!.id, record.model,
            prices.input, prices.output,
            prices.cacheRead, prices.cacheWrite
          );
          model = { id: result.lastInsertRowid as number };
        }

        const cost = calculateCost(
          record.model, record.inputTokens, record.outputTokens,
          record.cacheRead, record.cacheCreate
        );

        insertRecord.run(
          provider!.id,
          model.id,
          record.sessionId || null,
          record.inputTokens,
          record.outputTokens,
          record.cacheRead,
          record.cacheCreate,
          cost,
          record.timestamp,
          record.rawLine
        );
        synced++;
      } catch {
        errors++;
      }
    }
  })();

  return { synced, errors };
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string, depth: number): void {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  walk(dir, 0);
  return results;
}
