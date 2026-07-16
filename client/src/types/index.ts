export interface OverviewStats {
  total_requests: number;
  error_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_input_tokens: number;
  total_cache_output_tokens: number;
  total_cost: number;
}

export interface DailyStats {
  date: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_input_tokens: number;
  cache_output_tokens: number;
  cost: number;
  errors: number;
}

export interface HourlyStats {
  hour: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_input_tokens: number;
  cache_output_tokens: number;
  cost: number;
}

export interface ProviderStats {
  provider_id: number;
  provider_name: string;
  provider_type: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface ModelStats {
  model_id: number;
  model_name: string;
  provider_name: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_input_tokens: number;
  cache_output_tokens: number;
  cost: number;
}

export interface Provider {
  id: number;
  name: string;
  type: string;
  api_key: string | null;
  org_id: string | null;
  is_active: number;
  model_count: number;
}

export interface SyncResult {
  claude: { synced: number; errors: number };
  codex: { synced: number; errors: number };
  openai: { synced: number; errors: number };
}

export type TimeRange = '24h' | '7d' | '30d' | '180d' | '365d' | 'custom';
