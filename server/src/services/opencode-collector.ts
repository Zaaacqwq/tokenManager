import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from '../db/schema.js';
import { getModelPrices, calculateCost } from './pricing.js';

interface OpenCodeTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface OpenCodeMessageData {
  role?: string;
  cost?: number;
  tokens?: OpenCodeTokens;
  modelID?: string;
  providerID?: string;
  time?: { created?: number; completed?: number };
}

function resolveHome(filepath: string): string {
  return filepath.startsWith('~')
    ? path.join(process.env.HOME || '', filepath.slice(1))
    : filepath;
}

/**
 * Sync from OpenCode's SQLite database (~/.local/share/opencode/opencode.db).
 * Assistant messages store tokens, model, and OpenCode's own cost in the
 * `message.data` JSON column.
 */
export function syncOpenCode(): { synced: number; errors: number } {
  const dbPath = resolveHome(
    process.env.OPENCODE_DB_PATH || '~/.local/share/opencode/opencode.db'
  );

  if (!fs.existsSync(dbPath)) {
    return { synced: 0, errors: 0 };
  }

  const db = getDb();

  const syncState = db.prepare(
    'SELECT last_timestamp FROM sync_state WHERE source = ?'
  ).get('opencode') as { last_timestamp: string } | undefined;

  const lastTimestamp = syncState?.last_timestamp || '1970-01-01T00:00:00.000Z';
  const lastMs = Date.parse(lastTimestamp);

  let provider = db.prepare(
    "SELECT id FROM providers WHERE type = 'opencode' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (!provider) {
    const result = db.prepare(
      "INSERT INTO providers (name, type) VALUES ('OpenCode', 'opencode')"
    ).run();
    provider = { id: result.lastInsertRowid as number };
  }

  const findModel = db.prepare(
    'SELECT id FROM models WHERE provider_id = ? AND name = ?'
  );
  const insertModel = db.prepare(
    'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertRecord = db.prepare(`
    INSERT INTO usage_records (provider_id, model_id, source, session_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'opencode', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let synced = 0;
  let errors = 0;
  let latestTs = lastTimestamp;

  let source: Database.Database;
  try {
    source = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return { synced: 0, errors: 1 };
  }

  try {
    const rows = source.prepare(
      'SELECT session_id, data, time_created FROM message WHERE time_created > ? ORDER BY time_created'
    ).all(lastMs) as Array<{ session_id: string; data: string; time_created: number }>;

    db.transaction(() => {
      for (const row of rows) {
        try {
          const data: OpenCodeMessageData = JSON.parse(row.data);
          if (data.role !== 'assistant' || !data.tokens) continue;

          const tokens = data.tokens;
          const inputTokens = tokens.input || 0;
          const outputTokens = (tokens.output || 0) + (tokens.reasoning || 0);
          const cacheRead = tokens.cache?.read || 0;
          const cacheWrite = tokens.cache?.write || 0;
          if (!inputTokens && !outputTokens && !cacheRead && !cacheWrite) continue;

          const modelName = data.modelID || 'unknown';
          const ts = new Date(data.time?.created || row.time_created).toISOString();

          let model = findModel.get(provider!.id, modelName) as { id: number } | undefined;
          if (!model) {
            const prices = getModelPrices(modelName);
            const result = insertModel.run(
              provider!.id, modelName,
              prices.input, prices.output,
              prices.cacheRead, prices.cacheWrite
            );
            model = { id: result.lastInsertRowid as number };
          }

          // OpenCode records its own cost; trust it when present
          const cost = typeof data.cost === 'number' && data.cost > 0
            ? data.cost
            : calculateCost(modelName, inputTokens, outputTokens, cacheRead, cacheWrite);

          insertRecord.run(
            provider!.id,
            model.id,
            row.session_id,
            inputTokens,
            outputTokens,
            cacheRead,
            cacheWrite,
            cost,
            ts,
            row.data
          );
          synced++;

          if (ts > latestTs) latestTs = ts;
        } catch {
          errors++;
        }
      }

      if (latestTs > lastTimestamp) {
        db.prepare(`
          INSERT INTO sync_state (source, last_timestamp, updated_at)
          VALUES ('opencode', ?, datetime('now'))
          ON CONFLICT(source) DO UPDATE SET
            last_timestamp = excluded.last_timestamp,
            updated_at = datetime('now')
        `).run(latestTs);
      }
    })();
  } catch {
    errors++;
  } finally {
    source.close();
  }

  return { synced, errors };
}
