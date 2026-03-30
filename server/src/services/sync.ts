import cron from 'node-cron';
import { syncClaudeCode } from './claude-collector.js';
import { syncCodex } from './codex-collector.js';
import { syncOpenAI } from './openai-collector.js';
import { syncOpenClaw } from './openclaw-collector.js';
import { refreshPricing } from './pricing.js';

export async function runFullSync(): Promise<{
  claude: { synced: number; errors: number };
  codex: { synced: number; errors: number };
  openai: { synced: number; errors: number };
  openclaw: { synced: number; errors: number };
}> {
  console.log('[sync] Starting full sync...');

  // Refresh dynamic pricing before syncing
  await refreshPricing();

  const claude = syncClaudeCode();
  console.log(`[sync] Claude Code: ${claude.synced} synced, ${claude.errors} errors`);

  const codex = syncCodex();
  console.log(`[sync] Codex: ${codex.synced} synced, ${codex.errors} errors`);

  const openai = await syncOpenAI();
  console.log(`[sync] OpenAI: ${openai.synced} synced, ${openai.errors} errors`);

  const openclaw = syncOpenClaw();
  console.log(`[sync] OpenClaw: ${openclaw.synced} synced, ${openclaw.errors} errors`);

  return { claude, codex, openai, openclaw };
}

export function startSyncCron(): void {
  const schedule = process.env.SYNC_CRON || '*/30 * * * *';
  console.log(`[sync] Cron scheduled: ${schedule}`);

  cron.schedule(schedule, async () => {
    try {
      await runFullSync();
    } catch (err) {
      console.error('[sync] Cron sync failed:', err);
    }
  });
}
