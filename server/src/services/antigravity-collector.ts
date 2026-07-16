import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from '../db/schema.js';
import { getModelPrices, calculateCost } from './pricing.js';

/**
 * Antigravity CLI stores each conversation as a SQLite database under
 * ~/.gemini/antigravity-cli/conversations/<uuid>.db. Each `gen_metadata` row
 * is a protobuf blob; there is no published schema, so this module ships a
 * minimal wire-format reader and pulls only the fields it needs. Field
 * numbers follow tokscale's reverse-engineered map (verified against local
 * databases):
 *
 * - gen_metadata blob #1        → chatModel message
 *   - #19 (string)              → response model (e.g. gemini-3-flash-a)
 *   - #9.#4 = {#1 sec, #2 ns}   → per-generation wall-clock timestamp
 *   - #4                        → usage message
 *     - #1 (varint)             → fixed system-prompt input tokens
 *     - #2 (varint)             → newly-processed input tokens
 *     - #5 (varint)             → cache-read tokens
 *     - #9 (varint)             → output (text) tokens
 *     - #10 (varint)            → thinking/reasoning tokens
 *     - #11 (string)            → responseId (dedup key)
 * - trajectory_metadata_blob #2 → session created-at {#1 sec, #2 ns}
 */

// ---------------------------------------------------------------------------
// Minimal protobuf wire-format reader
// ---------------------------------------------------------------------------

interface ProtoField {
  field: number;
  varint?: bigint;
  bytes?: Buffer;
}

function readVarint(buf: Buffer, pos: number): [bigint, number] | null {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) return null;
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
    if (shift >= 64n) return null;
  }
}

function* iterFields(buf: Buffer): Generator<ProtoField> {
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (!tag) return;
    const field = Number(tag[0] >> 3n);
    const wire = Number(tag[0] & 7n);
    pos = tag[1];

    if (wire === 0) {
      const v = readVarint(buf, pos);
      if (!v) return;
      pos = v[1];
      yield { field, varint: v[0] };
    } else if (wire === 1) {
      pos += 8;
      if (pos > buf.length) return;
    } else if (wire === 2) {
      const len = readVarint(buf, pos);
      if (!len) return;
      const start = len[1];
      const end = start + Number(len[0]);
      if (end > buf.length) return;
      yield { field, bytes: buf.subarray(start, end) };
      pos = end;
    } else if (wire === 5) {
      pos += 4;
      if (pos > buf.length) return;
    } else {
      // deprecated group wire types — stop rather than risk desync
      return;
    }
  }
}

function messageField(buf: Buffer, field: number): Buffer | null {
  for (const f of iterFields(buf)) {
    if (f.field === field && f.bytes) return f.bytes;
  }
  return null;
}

function varintField(buf: Buffer, field: number): number {
  for (const f of iterFields(buf)) {
    if (f.field === field && f.varint !== undefined) {
      // Clamp untrusted varints into the safe integer range
      return f.varint > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(f.varint);
    }
  }
  return 0;
}

function stringField(buf: Buffer, field: number): string | null {
  const bytes = messageField(buf, field);
  return bytes ? bytes.toString('utf-8') : null;
}

/** Decode a protobuf {#1: seconds, #2: nanos} Timestamp to epoch ms. */
function protoTimestampMs(ts: Buffer | null): number {
  if (!ts) return 0;
  const seconds = varintField(ts, 1);
  const nanos = varintField(ts, 2);
  if (nanos < 0 || nanos > 999_999_999) return 0;
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

function resolveHome(filepath: string): string {
  return filepath.startsWith('~')
    ? path.join(process.env.HOME || '', filepath.slice(1))
    : filepath;
}

export function syncAntigravity(): { synced: number; errors: number } {
  const conversationsDir = resolveHome(
    process.env.ANTIGRAVITY_CONVERSATIONS_PATH || '~/.gemini/antigravity-cli/conversations'
  );

  if (!fs.existsSync(conversationsDir)) {
    return { synced: 0, errors: 0 };
  }

  const db = getDb();

  let provider = db.prepare(
    "SELECT id FROM providers WHERE type = 'antigravity' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (!provider) {
    const result = db.prepare(
      "INSERT INTO providers (name, type) VALUES ('Antigravity', 'antigravity')"
    ).run();
    provider = { id: result.lastInsertRowid as number };
  }

  const findModel = db.prepare(
    'SELECT id FROM models WHERE provider_id = ? AND name = ?'
  );
  const insertModel = db.prepare(
    'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // Dedup is exact via external_id (responseId, or sessionId:idx when the
  // blob lacks one) — no timestamp watermark, so multiple machines can
  // backfill history safely and re-scans are idempotent.
  const insertRecord = db.prepare(`
    INSERT OR IGNORE INTO usage_records (provider_id, model_id, source, session_id, external_id, input_tokens, output_tokens, cache_input_tokens, cache_output_tokens, cost_usd, recorded_at, raw_data)
    VALUES (?, ?, 'antigravity', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const dbFiles = fs.readdirSync(conversationsDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => path.join(conversationsDir, name));

  let synced = 0;
  let errors = 0;

  db.transaction(() => {
    for (const file of dbFiles) {
      let source: Database.Database;
      try {
        source = new Database(file, { readonly: true, fileMustExist: true });
      } catch {
        errors++;
        continue;
      }

      try {
        const sessionId = path.basename(file, '.db');

        // Session created-at: fallback timestamp for rows without their own
        let sessionCreatedMs = 0;
        try {
          const meta = source.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1')
            .get() as { data: Buffer } | undefined;
          if (meta?.data) {
            sessionCreatedMs = protoTimestampMs(messageField(meta.data, 2));
          }
        } catch {
          // table missing — keep fallback at file mtime below
        }
        if (!sessionCreatedMs) {
          sessionCreatedMs = fs.statSync(file).mtimeMs;
        }

        const rows = source.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx')
          .all() as Array<{ idx: number; data: Buffer }>;

        for (const row of rows) {
          try {
            const chatModel = messageField(row.data, 1);
            if (!chatModel) continue;
            const usage = messageField(chatModel, 4);
            if (!usage) continue;

            const inputTokens = varintField(usage, 1) + varintField(usage, 2);
            const cacheRead = varintField(usage, 5);
            const outputTokens = varintField(usage, 9) + varintField(usage, 10);
            if (!inputTokens && !cacheRead && !outputTokens) continue;

            const responseId = stringField(usage, 11)?.trim();
            const externalId = responseId || `${sessionId}:${row.idx}`;

            const gen = messageField(chatModel, 9);
            const genMs = gen ? protoTimestampMs(messageField(gen, 4)) : 0;
            const ts = new Date(genMs > 0 ? genMs : sessionCreatedMs).toISOString();

            const modelName = stringField(chatModel, 19)?.trim() || 'unknown';

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

            const cost = calculateCost(modelName, inputTokens, outputTokens, cacheRead, 0);

            const result = insertRecord.run(
              provider!.id,
              model.id,
              sessionId,
              externalId,
              inputTokens,
              outputTokens,
              cacheRead,
              0,
              cost,
              ts,
              null
            );
            synced += result.changes;
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
      } finally {
        source.close();
      }
    }
  })();

  return { synced, errors };
}
