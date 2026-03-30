import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db/schema.js';
import { seedDefaults } from './db/seed.js';
import { startSyncCron, runFullSync } from './services/sync.js';
import { refreshPricing } from './services/pricing.js';
import authRouter from './routes/auth.js';
import statsRouter from './routes/stats.js';
import providersRouter from './routes/providers.js';
import uploadRouter from './routes/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3456;

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/stats', statsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/upload', uploadRouter);

// Serve frontend static files
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Initialize
async function main(): Promise<void> {
  // Ensure data directory exists
  const fs = await import('fs');
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Init database
  getDb();
  seedDefaults();
  console.log('[db] Database initialized');

  // Load dynamic pricing
  await refreshPricing();

  // Initial sync
  await runFullSync();

  // Start cron
  startSyncCron();

  app.listen(PORT, () => {
    console.log(`[server] Running on http://localhost:${PORT}`);
  });
}

main().catch(console.error);
