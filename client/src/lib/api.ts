const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function buildQs(params?: Record<string, string>): string {
  if (!params) return '';
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== undefined)
  );
  const qs = new URLSearchParams(filtered).toString();
  return qs ? `?${qs}` : '';
}

export interface FilterOptions {
  providers: Array<{ id: number; name: string; type: string }>;
  models: Array<{ id: number; name: string; provider_name: string; provider_id: number }>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getFilters: () =>
    request<FilterOptions>('/stats/filters'),

  getOverview: (params?: Record<string, string>) =>
    request<Record<string, number>>(`/stats/overview${buildQs(params)}`),

  getDaily: (params?: Record<string, string>) =>
    request<Array<Record<string, number | string>>>(`/stats/daily${buildQs(params)}`),

  getHourly: (params?: Record<string, string>) =>
    request<Array<Record<string, number | string>>>(`/stats/hourly${buildQs(params)}`),

  getByProvider: (params?: Record<string, string>) =>
    request<Array<Record<string, number | string>>>(`/stats/by-provider${buildQs(params)}`),

  getByModel: (params?: Record<string, string>) =>
    request<Array<Record<string, number | string>>>(`/stats/by-model${buildQs(params)}`),

  getProviders: () =>
    request<Array<Record<string, unknown>>>('/providers'),

  syncNow: () =>
    request<Record<string, { synced: number; errors: number }>>('/stats/sync', { method: 'POST' }),
};
