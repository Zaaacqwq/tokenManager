import { getDb } from '../db/schema.js';

interface OpenAIUsageBucket {
  start_time: number;
  end_time: number;
  results: Array<{
    object: string;
    input_tokens: number;
    output_tokens: number;
    input_cached_tokens: number;
    num_model_requests: number;
    project_id: string;
    model: string;
  }>;
}

export async function syncOpenAI(): Promise<{ synced: number; errors: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { synced: 0, errors: 0 };
  }

  const db = getDb();

  // Get sync state
  const syncState = db.prepare(
    'SELECT last_timestamp FROM sync_state WHERE source = ?'
  ).get('openai') as { last_timestamp: string } | undefined;

  // Default to 30 days ago
  const startTime = syncState?.last_timestamp
    ? Math.floor(new Date(syncState.last_timestamp).getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

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

  let synced = 0;
  let errors = 0;

  try {
    const url = new URL('https://api.openai.com/v1/organization/usage/completions');
    url.searchParams.set('start_time', startTime.toString());
    url.searchParams.set('bucket_width', '1d');
    if (process.env.OPENAI_ORG_ID) {
      url.searchParams.set('organization_id', process.env.OPENAI_ORG_ID);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`OpenAI API error: ${response.status} ${text}`);
      return { synced: 0, errors: 1 };
    }

    const data = await response.json() as { data: OpenAIUsageBucket[] };

    const findModel = db.prepare(
      'SELECT id FROM models WHERE provider_id = ? AND name = ?'
    );
    const insertModel = db.prepare(
      'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m) VALUES (?, ?, ?, ?, ?)'
    );

    // Check for existing records to avoid duplicates
    const checkExisting = db.prepare(`
      SELECT id FROM usage_records
      WHERE source = 'openai_api' AND recorded_at = ? AND model_id = ?
      LIMIT 1
    `);

    const insertRecord = db.prepare(`
      INSERT INTO usage_records (provider_id, model_id, source, input_tokens, output_tokens, cache_input_tokens, cost_usd, recorded_at, raw_data)
      VALUES (?, ?, 'openai_api', ?, ?, ?, ?, ?, ?)
    `);

    let latestTimestamp = syncState?.last_timestamp || '';

    db.transaction(() => {
      for (const bucket of data.data || []) {
        for (const result of bucket.results || []) {
          try {
            const modelName = result.model || 'unknown';
            let model = findModel.get(provider!.id, modelName) as { id: number } | undefined;
            if (!model) {
              const prices = getOpenAIPrices(modelName);
              const insertResult = insertModel.run(
                provider!.id, modelName, prices.input, prices.output, prices.cacheInput
              );
              model = { id: insertResult.lastInsertRowid as number };
            }

            const recordedAt = new Date(bucket.start_time * 1000).toISOString();

            // Skip if already exists
            const existing = checkExisting.get(recordedAt, model.id);
            if (existing) continue;

            const cost = calculateOpenAICost(
              modelName,
              result.input_tokens,
              result.output_tokens,
              result.input_cached_tokens
            );

            insertRecord.run(
              provider!.id,
              model.id,
              result.input_tokens || 0,
              result.output_tokens || 0,
              result.input_cached_tokens || 0,
              cost,
              recordedAt,
              JSON.stringify(result)
            );
            synced++;

            if (recordedAt > latestTimestamp) {
              latestTimestamp = recordedAt;
            }
          } catch {
            errors++;
          }
        }
      }

      if (latestTimestamp) {
        db.prepare(`
          INSERT INTO sync_state (source, last_timestamp, updated_at)
          VALUES ('openai', ?, datetime('now'))
          ON CONFLICT(source) DO UPDATE SET
            last_timestamp = excluded.last_timestamp,
            updated_at = datetime('now')
        `).run(latestTimestamp);
      }
    })();
  } catch (err) {
    console.error('OpenAI sync error:', err);
    errors++;
  }

  return { synced, errors };
}

function getOpenAIPrices(model: string): { input: number; output: number; cacheInput: number } {
  const lower = model.toLowerCase();
  if (lower.includes('gpt-4o-mini')) return { input: 0.15, output: 0.6, cacheInput: 0.075 };
  if (lower.includes('gpt-4o')) return { input: 2.5, output: 10, cacheInput: 1.25 };
  if (lower.includes('o3')) return { input: 10, output: 40, cacheInput: 2.5 };
  if (lower.includes('o1')) return { input: 15, output: 60, cacheInput: 7.5 };
  if (lower.includes('codex')) return { input: 1.5, output: 6, cacheInput: 0.75 };
  return { input: 2.5, output: 10, cacheInput: 1.25 };
}

function calculateOpenAICost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheInputTokens: number
): number {
  const prices = getOpenAIPrices(model);
  const regularInput = inputTokens - cacheInputTokens;
  return (
    (regularInput * prices.input) / 1_000_000 +
    (cacheInputTokens * prices.cacheInput) / 1_000_000 +
    (outputTokens * prices.output) / 1_000_000
  );
}
