import { getDb } from './schema.js';
import bcrypt from 'bcryptjs';

export function seedDefaults(): void {
  const db = getDb();

  // Seed admin user if not exists
  const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get(
    process.env.ADMIN_USERNAME || 'admin'
  );
  if (!adminUser) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin', 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
      process.env.ADMIN_USERNAME || 'admin',
      hash
    );
  }

  // Seed default providers
  const providerCount = db.prepare('SELECT COUNT(*) as c FROM providers').get() as { c: number };
  if (providerCount.c === 0) {
    const insertProvider = db.prepare(
      'INSERT INTO providers (name, type) VALUES (?, ?)'
    );
    const insertModel = db.prepare(
      'INSERT INTO models (provider_id, name, input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m) VALUES (?, ?, ?, ?, ?, ?)'
    );

    db.transaction(() => {
      // Anthropic
      const anthropic = insertProvider.run('Anthropic', 'anthropic');
      const anthropicId = anthropic.lastInsertRowid as number;
      insertModel.run(anthropicId, 'claude-opus-4', 15, 75, 7.5, 37.5);
      insertModel.run(anthropicId, 'claude-sonnet-4', 3, 15, 1.5, 7.5);
      insertModel.run(anthropicId, 'claude-haiku-4', 0.8, 4, 0.4, 2);

      // OpenAI
      const openai = insertProvider.run('OpenAI', 'openai');
      const openaiId = openai.lastInsertRowid as number;
      insertModel.run(openaiId, 'gpt-4o', 2.5, 10, 1.25, 5);
      insertModel.run(openaiId, 'gpt-4o-mini', 0.15, 0.6, 0.075, 0.3);
      insertModel.run(openaiId, 'o1', 15, 60, 7.5, 30);
      insertModel.run(openaiId, 'o3', 10, 40, 2.5, 10);
      insertModel.run(openaiId, 'codex-mini', 1.5, 6, 0.75, 3);

      // Google
      const google = insertProvider.run('Google', 'google');
      const googleId = google.lastInsertRowid as number;
      insertModel.run(googleId, 'gemini-2.5-pro', 1.25, 10, 0.315, 2.5);
      insertModel.run(googleId, 'gemini-2.5-flash', 0.15, 0.6, 0.0375, 0.15);
    })();
  }
}
