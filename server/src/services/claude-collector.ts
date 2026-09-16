import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { getModelPrices, calculateCost } from './pricing.js';
import { readJsonlLines } from './read-jsonl.js';

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

/** Exact-dedup key; null when the entry carries no usable id. */
function externalIdOf(record: DedupedRecord): string | null {
  return record.messageId || record.requestId
    ? `${record.messageId}:${record.requestId}`
    : null;
}

/**
 * Parse a JSONL file and return deduplicated usage records.
 * Claude Code streaming creates multiple entries with the same message.id + requestId.
 * We keep only the entry with the highest output_tokens per group (the final count).
 */
function parseDedupedRecords(file: string): DedupedRecord[] {
  // Group by composite key: messageId:requestId
  const groups = new Map<string, DedupedRecord>();

  for (const line of readJsonlLines(file)) {
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
 * Deduplicates streaming responses using message.id + requestId composite key,
 * which is also the external_id stored in the DB — dedup is exact, so every
 * file is re-scanned each run and machines can backfill history at any time
 * (a shared timestamp watermark would have dropped anything older than what
 * the other machines had already reported).
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

  const jsonlFiles = findJsonlFiles(projectsDir);

  const insertRecord = db.prepare(`
    INSERT OR IGNORE INTO usage_records (provider_id, model_id, source, session_id, external_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'claude_code', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    for (const file of jsonlFiles) {
      try {
        const records = parseDedupedRecords(file);

        for (const record of records) {
          try {
            const externalId = externalIdOf(record);
            // Without a key the row would re-insert on every run
            if (!externalId) continue;

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

            const result = insertRecord.run(
              provider!.id,
              model.id,
              record.sessionId || null,
              externalId,
              record.inputTokens,
              record.outputTokens,
              record.cacheRead,
              record.cacheCreate,
              cost,
              record.timestamp,
              record.rawLine
            );
            synced += result.changes;
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
      }
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

  // Same source and key as the file scan: a message that arrives both ways
  // (uploaded here and rsynced to the VPS) is stored once.
  const insertRecord = db.prepare(`
    INSERT OR IGNORE INTO usage_records (provider_id, model_id, source, session_id, external_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'claude_code', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        const externalId = externalIdOf(record);
        if (!externalId) continue;

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

        const result = insertRecord.run(
          provider!.id,
          model.id,
          record.sessionId || null,
          externalId,
          record.inputTokens,
          record.outputTokens,
          record.cacheRead,
          record.cacheCreate,
          cost,
          record.timestamp,
          record.rawLine
        );
        synced += result.changes;
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
