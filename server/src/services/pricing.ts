import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '../../data/pricing_cache.json');
const CACHE_TTL_MS = 3600_000; // 1 hour

interface PricingEntry {
  input_cost_per_token: number;
  output_cost_per_token: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

interface PricingCache {
  fetchedAt: number;
  prices: Record<string, PricingEntry>;
}

let memoryCache: PricingCache | null = null;

// Hardcoded fallback prices (per 1M tokens)
const FALLBACK_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus': { input: 15, output: 75, cacheRead: 1.875, cacheWrite: 18.75 },
  'claude-sonnet': { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 },
  'claude-haiku': { input: 0.8, output: 4, cacheRead: 0.1, cacheWrite: 1 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  'o3': { input: 10, output: 40, cacheRead: 2.5, cacheWrite: 0 },
  'o1': { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
  'codex-mini': { input: 1.5, output: 6, cacheRead: 0.75, cacheWrite: 0 },
  'gpt-5.3-codex': { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
};

function loadDiskCache(): PricingCache | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(raw) as PricingCache;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveDiskCache(cache: PricingCache): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

async function fetchLiteLLMPrices(): Promise<Record<string, PricingEntry>> {
  const url = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as Record<string, Record<string, unknown>>;

  const prices: Record<string, PricingEntry> = {};
  for (const [model, info] of Object.entries(data)) {
    if (model === 'sample_spec') continue;
    const inputCost = info.input_cost_per_token;
    const outputCost = info.output_cost_per_token;
    if (typeof inputCost === 'number' && typeof outputCost === 'number') {
      prices[model] = {
        input_cost_per_token: inputCost,
        output_cost_per_token: outputCost,
        cache_read_input_token_cost: (info.cache_read_input_token_cost as number) || undefined,
        cache_creation_input_token_cost: (info.cache_creation_input_token_cost as number) || undefined,
      };
    }
  }
  return prices;
}

export async function refreshPricing(): Promise<void> {
  try {
    const prices = await fetchLiteLLMPrices();
    const cache: PricingCache = { fetchedAt: Date.now(), prices };
    memoryCache = cache;
    saveDiskCache(cache);
    console.log(`[pricing] Fetched ${Object.keys(prices).length} model prices from LiteLLM`);
  } catch (err) {
    console.error('[pricing] Failed to fetch LiteLLM prices, using fallback:', err);
    // Try loading from disk cache even if expired
    if (!memoryCache) {
      memoryCache = loadDiskCache();
    }
  }
}

function getCache(): PricingCache | null {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache;
  }
  // Try disk cache
  const disk = loadDiskCache();
  if (disk && Date.now() - disk.fetchedAt < CACHE_TTL_MS) {
    memoryCache = disk;
    return disk;
  }
  return memoryCache || disk;
}

function findPriceInCache(modelName: string, cache: PricingCache): PricingEntry | null {
  const lower = modelName.toLowerCase();

  // Direct match
  if (cache.prices[lower]) return cache.prices[lower];
  if (cache.prices[modelName]) return cache.prices[modelName];

  // Try with provider prefixes
  const prefixes = ['anthropic/', 'openai/', 'google/', ''];
  for (const prefix of prefixes) {
    const key = `${prefix}${lower}`;
    if (cache.prices[key]) return cache.prices[key];
  }

  // Partial match
  for (const [key, entry] of Object.entries(cache.prices)) {
    if (key.includes(lower) || lower.includes(key.split('/').pop() || '')) {
      return entry;
    }
  }

  return null;
}

export function getModelPrices(modelName: string): {
  input: number; output: number; cacheRead: number; cacheWrite: number;
} {
  // Try dynamic pricing first
  const cache = getCache();
  if (cache) {
    const entry = findPriceInCache(modelName, cache);
    if (entry) {
      return {
        input: entry.input_cost_per_token * 1_000_000,
        output: entry.output_cost_per_token * 1_000_000,
        cacheRead: (entry.cache_read_input_token_cost || entry.input_cost_per_token * 0.125) * 1_000_000,
        cacheWrite: (entry.cache_creation_input_token_cost || entry.input_cost_per_token * 1.25) * 1_000_000,
      };
    }
  }

  // Fallback to hardcoded
  const lower = modelName.toLowerCase();
  for (const [key, prices] of Object.entries(FALLBACK_PRICES)) {
    if (lower.includes(key)) return prices;
  }

  // Default
  return { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 };
}

export function calculateCost(
  model: string, input: number, output: number,
  cacheRead: number, cacheWrite: number
): number {
  const prices = getModelPrices(model);
  return (
    (input * prices.input) / 1_000_000 +
    (output * prices.output) / 1_000_000 +
    (cacheRead * prices.cacheRead) / 1_000_000 +
    (cacheWrite * prices.cacheWrite) / 1_000_000
  );
}
