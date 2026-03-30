import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/providers
router.get('/', (_req: Request, res: Response): void => {
  const db = getDb();
  const providers = db.prepare(`
    SELECT p.*, COUNT(m.id) as model_count
    FROM providers p
    LEFT JOIN models m ON m.provider_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `).all();
  res.json(providers);
});

// GET /api/providers/:id/models
router.get('/:id/models', (req: Request, res: Response): void => {
  const db = getDb();
  const models = db.prepare(
    'SELECT * FROM models WHERE provider_id = ? ORDER BY name'
  ).all(Number(req.params.id));
  res.json(models);
});

// PUT /api/providers/:id
router.put('/:id', (req: Request, res: Response): void => {
  const { name, api_key, org_id, is_active } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE providers SET name = ?, api_key = ?, org_id = ?, is_active = ?
    WHERE id = ?
  `).run(name, api_key || null, org_id || null, is_active ?? 1, Number(req.params.id));

  res.json({ message: 'Updated' });
});

// PUT /api/providers/:providerId/models/:modelId
router.put('/:providerId/models/:modelId', (req: Request, res: Response): void => {
  const { input_price_per_m, output_price_per_m, cache_input_price_per_m, cache_output_price_per_m } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE models SET
      input_price_per_m = ?,
      output_price_per_m = ?,
      cache_input_price_per_m = ?,
      cache_output_price_per_m = ?
    WHERE id = ? AND provider_id = ?
  `).run(
    input_price_per_m,
    output_price_per_m,
    cache_input_price_per_m || 0,
    cache_output_price_per_m || 0,
    Number(req.params.modelId),
    Number(req.params.providerId)
  );

  res.json({ message: 'Updated' });
});

// GET /api/providers/sync-state
router.get('/sync-state', (_req: Request, res: Response): void => {
  const db = getDb();
  const states = db.prepare('SELECT * FROM sync_state').all();
  res.json(states);
});

export default router;
