import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { getModelPrices, calculateCost } from './pricing.js';
import { readJsonlLines } from './read-jsonl.js';

interface OpenClawUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

interface OpenClawEntry {
  type: string;
  id: string;
  timestamp: string;
  customType?: string;
  message?: {
    role?: string;
    model?: string;
    provider?: string;
    usage?: OpenClawUsage;
  };
  data?: {
    provider?: string;
    modelId?: string;
  };
}

function resolveHome(filepath: string): string {
  return filepath.startsWith('~')
    ? path.join(process.env.HOME || '', filepath.slice(1))
    : filepath;
}

/**
 * Sync from OpenClaw session JSONL files in ~/.openclaw/agents/
 * Parses assistant messages with usage data (input, output, cacheRead, cacheWrite).
 */
export function syncOpenClaw(): { synced: number; errors: number } {
  const agentsDir = resolveHome(
    process.env.OPENCLAW_AGENTS_PATH || '~/.openclaw/agents'
  );

  if (!fs.existsSync(agentsDir)) {
    return { synced: 0, errors: 0 };
  }

  const db = getDb();

  // Get sync state
  const syncState = db.prepare(
    'SELECT last_timestamp FROM sync_state WHERE source = ?'
  ).get('openclaw') as { last_timestamp: string } | undefined;

  const lastTimestamp = syncState?.last_timestamp || '1970-01-01T00:00:00.000Z';

  // Find or create OpenClaw provider (separate from OpenAI)
  let provider = db.prepare(
    "SELECT id FROM providers WHERE type = 'openclaw' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (!provider) {
    const result = db.prepare(
      "INSERT INTO providers (name, type) VALUES ('OpenClaw', 'openclaw')"
    ).run();
    provider = { id: result.lastInsertRowid as number };
  }

  const jsonlFiles = findJsonlFiles(agentsDir);

  const findModel = db.prepare(
    'SELECT id FROM models WHERE provider_id = ? AND name = ?'
  );
  const insertModel = db.prepare(
    'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertRecord = db.prepare(`
    INSERT INTO usage_records (provider_id, model_id, source, session_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'openclaw', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let synced = 0;
  let errors = 0;
  let latestTs = lastTimestamp;

  db.transaction(() => {
    for (const file of jsonlFiles) {
      try {
        // Extract session ID from directory name or session entry
        let sessionId = path.basename(path.dirname(file));

        for (const line of readJsonlLines(file)) {
          try {
            const entry: OpenClawEntry = JSON.parse(line);

            // Capture session ID from session entry
            if (entry.type === 'session') {
              sessionId = entry.id || sessionId;
              continue;
            }

            // Only process assistant messages with usage data
            if (entry.type !== 'message') continue;
            if (entry.message?.role !== 'assistant') continue;

            const usage = entry.message.usage;
            if (!usage) continue;
            if (!usage.input && !usage.output && !usage.cacheRead && !usage.cacheWrite) continue;

            const ts = entry.timestamp || '';
            if (ts <= lastTimestamp) continue;

            const modelName = entry.message.model || 'gpt-5.3-codex';
            const inputTokens = usage.input || 0;
            const outputTokens = usage.output || 0;
            const cacheRead = usage.cacheRead || 0;
            const cacheWrite = usage.cacheWrite || 0;

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

            // Use OpenClaw's own cost if available, otherwise calculate
            const cost = usage.cost?.total ?? calculateCost(
              modelName, inputTokens, outputTokens, cacheRead, cacheWrite
            );

            insertRecord.run(
              provider!.id,
              model.id,
              sessionId,
              inputTokens,
              outputTokens,
              cacheRead,
              cacheWrite,
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
        VALUES ('openclaw', ?, datetime('now'))
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
