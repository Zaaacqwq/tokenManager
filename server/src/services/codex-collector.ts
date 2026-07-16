import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { getModelPrices, calculateCost } from './pricing.js';
import { readJsonlLines } from './read-jsonl.js';

interface TokenCountPayload {
  type: 'token_count';
  info: {
    total_token_usage: {
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      reasoning_output_tokens: number;
      total_tokens: number;
    };
    last_token_usage: {
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      reasoning_output_tokens: number;
      total_tokens: number;
    };
  } | null;
  rate_limits?: {
    limit_id: string;
    plan_type: string;
  };
}

interface SessionMeta {
  type: 'session_meta';
  payload: {
    id: string;
    model_provider: string;
    source: string;
    cli_version: string;
  };
}

interface CodexEvent {
  timestamp: string;
  type: string;
  payload: TokenCountPayload | SessionMeta['payload'] | Record<string, unknown>;
}

function resolveHome(filepath: string): string {
  return filepath.startsWith('~')
    ? path.join(process.env.HOME || '', filepath.slice(1))
    : filepath;
}

export function syncCodex(): { synced: number; errors: number } {
  const sessionsDir = resolveHome(
    process.env.CODEX_SESSIONS_PATH || '~/.codex/sessions'
  );

  if (!fs.existsSync(sessionsDir)) {
    return { synced: 0, errors: 0 };
  }

  const db = getDb();

  // Get sync state
  const syncState = db.prepare(
    'SELECT last_timestamp FROM sync_state WHERE source = ?'
  ).get('codex') as { last_timestamp: string } | undefined;

  const lastTimestamp = syncState?.last_timestamp || '1970-01-01T00:00:00.000Z';

  // Find or create OpenAI provider
  let provider = db.prepare(
    "SELECT id FROM providers WHERE type = 'openai' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (!provider) {
    const result = db.prepare(
      "INSERT INTO providers (name, type) VALUES ('OpenAI', 'openai')"
    ).run();
    provider = { id: result.lastInsertRowid as number };
  }

  const jsonlFiles = findJsonlFiles(sessionsDir);

  const findModel = db.prepare(
    'SELECT id FROM models WHERE provider_id = ? AND name = ?'
  );
  const insertModel = db.prepare(
    'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertRecord = db.prepare(`
    INSERT INTO usage_records (provider_id, model_id, source, session_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let synced = 0;
  let errors = 0;
  let latestTs = lastTimestamp;

  db.transaction(() => {
    for (const file of jsonlFiles) {
      try {
        let sessionId = '';

        for (const line of readJsonlLines(file)) {
          try {
            const event: CodexEvent = JSON.parse(line);

            // Capture session ID from meta
            if (event.type === 'session_meta') {
              const meta = event.payload as SessionMeta['payload'];
              sessionId = meta.id || '';
              continue;
            }

            // Only process token_count events with last_token_usage (incremental)
            if (event.type !== 'event_msg') continue;
            const payload = event.payload as TokenCountPayload;
            if (payload.type !== 'token_count' || !payload.info?.last_token_usage) continue;

            const ts = event.timestamp || '';
            if (ts <= lastTimestamp) continue;

            const usage = payload.info.last_token_usage;
            const inputTokens = usage.input_tokens || 0;
            const outputTokens = usage.output_tokens || 0;
            const cachedInput = usage.cached_input_tokens || 0;
            const reasoningOutput = usage.reasoning_output_tokens || 0;

            const modelName = 'codex-mini';
            const prices = getModelPrices(modelName);

            let model = findModel.get(provider!.id, modelName) as { id: number } | undefined;
            if (!model) {
              const result = insertModel.run(
                provider!.id, modelName,
                prices.input, prices.output,
                prices.cacheRead, prices.cacheWrite
              );
              model = { id: result.lastInsertRowid as number };
            }

            const cost = calculateCost(
              modelName, inputTokens, outputTokens, cachedInput, 0
            );

            insertRecord.run(
              provider!.id,
              model.id,
              sessionId,
              inputTokens,
              outputTokens,
              cachedInput,
              reasoningOutput,
              cost,
              ts,
              line
            );
            synced++;

            if (ts > latestTs) latestTs = ts;
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
      }
    }

    if (latestTs > lastTimestamp) {
      db.prepare(`
        INSERT INTO sync_state (source, last_timestamp, updated_at)
        VALUES ('codex', ?, datetime('now'))
        ON CONFLICT(source) DO UPDATE SET
          last_timestamp = excluded.last_timestamp,
          updated_at = datetime('now')
      `).run(latestTs);
    }
  })();

  return { synced, errors };
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string, depth: number): void {
    if (depth > 6) return;
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
      // skip inaccessible
    }
  }

  walk(dir, 0);
  return results;
}
