import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { runFullSync } from '../services/sync.js';

const router = Router();
router.use(authMiddleware);

function buildWhere(query: Record<string, unknown>): { where: string; params: unknown[] } {
  const { start, end, provider, source, model, models } = query;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (start) {
    conditions.push('u.recorded_at >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('u.recorded_at <= ?');
    const endStr = String(end);
    params.push(endStr.includes('T') ? endStr : endStr + 'T23:59:59');
  }
  if (provider) {
    conditions.push('u.provider_id = ?');
    params.push(Number(provider));
  }
  // Support comma-separated model IDs: ?models=1,2,3
  if (models) {
    const ids = String(models).split(',').map(Number).filter(Boolean);
    if (ids.length > 0) {
      conditions.push(`u.model_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  } else if (model) {
    conditions.push('u.model_id = ?');
    params.push(Number(model));
  }
  if (source) {
    conditions.push('u.source = ?');
    params.push(source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// GET /api/stats/filters - Available providers and models
router.get('/filters', (_req: Request, res: Response): void => {
  const db = getDb();

  const providers = db.prepare(`
    SELECT DISTINCT p.id, p.name, p.type
    FROM providers p
    JOIN usage_records u ON u.provider_id = p.id
    ORDER BY p.name
  `).all();

  const models = db.prepare(`
    SELECT DISTINCT m.id, m.name, p.name as provider_name, p.id as provider_id
    FROM models m
    JOIN providers p ON m.provider_id = p.id
    JOIN usage_records u ON u.model_id = m.id
    ORDER BY p.name, m.name
  `).all();

  res.json({ providers, models });
});

// GET /api/stats/overview
router.get('/overview', (req: Request, res: Response): void => {
  const db = getDb();
  const { where, params } = buildWhere(req.query);

  const overview = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as error_count,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cache_input_tokens) as total_cache_input_tokens,
      SUM(cache_output_tokens) as total_cache_output_tokens,
      SUM(cost_usd) as total_cost
    FROM usage_records u
    ${where}
  `).get(...params);

  res.json(overview);
});

// GET /api/stats/daily
router.get('/daily', (req: Request, res: Response): void => {
  const db = getDb();
  const { where, params } = buildWhere(req.query);

  const daily = db.prepare(`
    SELECT
      date(recorded_at) as date,
      COUNT(*) as requests,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cache_input_tokens) as cache_input_tokens,
      SUM(cache_output_tokens) as cache_output_tokens,
      SUM(cost_usd) as cost,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as errors
    FROM usage_records u
    ${where}
    GROUP BY date(recorded_at)
    ORDER BY date ASC
  `).all(...params);

  res.json(daily);
});

// GET /api/stats/hourly?start=&end=&date=&provider=&model=
// If start/end provided, groups by "YYYY-MM-DD HH:00" across the range.
// If only date provided, groups by "HH:00" for that single day.
router.get('/hourly', (req: Request, res: Response): void => {
  const db = getDb();
  const { date } = req.query;

  // If start/end are given (24h range), use them directly via buildWhere
  if (req.query.start && req.query.end) {
    const { where, params } = buildWhere(req.query);

    const hourly = db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00Z', recorded_at) as hour,
        COUNT(*) as requests,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cache_input_tokens) as cache_input_tokens,
        SUM(cache_output_tokens) as cache_output_tokens,
        SUM(cost_usd) as cost
      FROM usage_records u
      ${where}
      GROUP BY strftime('%Y-%m-%d %H', recorded_at)
      ORDER BY strftime('%Y-%m-%d %H', recorded_at) ASC
    `).all(...params);

    res.json(hourly);
    return;
  }

  // Fallback: single date mode
  const targetDate = (date as string) || new Date().toISOString().split('T')[0];
  const { where: extraWhere, params: extraParams } = buildWhere(req.query);

  const conditions = [`date(u.recorded_at) = ?`];
  const params: unknown[] = [targetDate];

  if (extraWhere) {
    conditions.push(extraWhere.replace(/^WHERE\s+/, ''));
    params.push(...extraParams);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const hourly = db.prepare(`
    SELECT
      strftime('%H:00', recorded_at) as hour,
      COUNT(*) as requests,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cache_input_tokens) as cache_input_tokens,
      SUM(cache_output_tokens) as cache_output_tokens,
      SUM(cost_usd) as cost
    FROM usage_records u
    ${where}
    GROUP BY strftime('%H', recorded_at)
    ORDER BY hour ASC
  `).all(...params);

  res.json(hourly);
});

// GET /api/stats/by-provider
router.get('/by-provider', (req: Request, res: Response): void => {
  const db = getDb();
  const { where, params } = buildWhere(req.query);

  const byProvider = db.prepare(`
    SELECT
      p.id as provider_id,
      p.name as provider_name,
      p.type as provider_type,
      COUNT(*) as requests,
      SUM(u.input_tokens) as input_tokens,
      SUM(u.output_tokens) as output_tokens,
      SUM(u.cost_usd) as cost
    FROM usage_records u
    JOIN providers p ON u.provider_id = p.id
    ${where}
    GROUP BY p.id
    ORDER BY cost DESC
  `).all(...params);

  res.json(byProvider);
});

// GET /api/stats/by-model
router.get('/by-model', (req: Request, res: Response): void => {
  const db = getDb();
  const { where, params } = buildWhere(req.query);

  const byModel = db.prepare(`
    SELECT
      m.id as model_id,
      m.name as model_name,
      p.name as provider_name,
      COUNT(*) as requests,
      SUM(u.input_tokens) as input_tokens,
      SUM(u.output_tokens) as output_tokens,
      SUM(u.cache_input_tokens) as cache_input_tokens,
      SUM(u.cache_output_tokens) as cache_output_tokens,
      SUM(u.cost_usd) as cost
    FROM usage_records u
    JOIN models m ON u.model_id = m.id
    JOIN providers p ON u.provider_id = p.id
    ${where}
    GROUP BY m.id
    ORDER BY cost DESC
  `).all(...params);

  res.json(byModel);
});

// POST /api/stats/sync - Manual trigger
router.post('/sync', async (_req: Request, res: Response): Promise<void> => {
  const result = await runFullSync();
  res.json(result);
});

export default router;
