import { useState, useEffect, useCallback, useRef } from 'react';
import { Zap, RefreshCw, LogOut, Globe } from 'lucide-react';
import { api } from '@/lib/api';
import type { FilterOptions } from '@/lib/api';
import { formatTokens, formatCost, formatNumber, formatPercent, getDateRange } from '@/lib/format';
import { t, getStoredLocale, setStoredLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import StatsCard from '@/components/StatsCard';
import TokenChart from '@/components/TokenChart';
import CostChart from '@/components/CostChart';
import ProviderBreakdown from '@/components/ProviderBreakdown';
import ModelBreakdown from '@/components/ModelBreakdown';
import TimeRangeSelector from '@/components/TimeRangeSelector';
import type { ModelStats, TimeRange } from '@/types';

interface Props {
  username: string | null;
  onLogout: () => void;
}

function fillHourlyGaps(
  data: Array<Record<string, number | string>>,
  startIso: string
): Array<Record<string, number | string>> {
  const dataMap = new Map<string, Record<string, number | string>>();
  for (const row of data) dataMap.set(String(row.hour), row);
  const startDate = new Date(startIso);
  startDate.setMinutes(0, 0, 0);
  const result: Array<Record<string, number | string>> = [];
  for (let i = 0; i < 24; i++) {
    const slotDate = new Date(startDate.getTime() + i * 3600_000);
    const utcKey = slotDate.toISOString().replace(/:\d{2}\.\d{3}Z$/, ':00Z');
    const localHour = slotDate.getHours().toString().padStart(2, '0') + ':00';
    const existing = dataMap.get(utcKey);
    result.push(existing
      ? { ...existing, hour: localHour }
      : { hour: localHour, requests: 0, input_tokens: 0, output_tokens: 0, cache_input_tokens: 0, cache_output_tokens: 0, cost: 0 }
    );
  }
  return result;
}

export default function DashboardPage({ username, onLogout }: Props) {
  const [locale, setLocale] = useState<Locale>(getStoredLocale);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Unfiltered breakdown data
  const [byProvider, setByProvider] = useState<Array<Record<string, number | string>>>([]);
  const [byModel, setByModel] = useState<Array<Record<string, number | string>>>([]);

  // Filtered stats data
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [chartData, setChartData] = useState<Array<Record<string, number | string>>>([]);

  // Selection: provider + active model IDs (models that are highlighted)
  const [selectedProvider, setSelectedProvider] = useState('');
  const [activeModelIds, setActiveModelIds] = useState<Set<string>>(new Set());
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ providers: [], models: [] });

  const isFilterChange = useRef(false);

  useEffect(() => { api.getFilters().then(setFilterOptions).catch(() => {}); }, []);

  const toggleLocale = () => {
    const next = locale === 'en' ? 'zh' : 'en';
    setLocale(next);
    setStoredLocale(next);
  };

  // Get all model IDs belonging to a provider (from byModel data)
  const getProviderModelIds = useCallback((providerId: string): Set<string> => {
    const providerName = String(byProvider.find((p) => String(p.provider_id) === providerId)?.provider_name ?? '');
    return new Set(
      byModel
        .filter((m) => String(m.provider_name) === providerName)
        .map((m) => String(m.model_id))
    );
  }, [byProvider, byModel]);

  // Fetch breakdown (unfiltered)
  const fetchBreakdown = useCallback(async () => {
    const range = getDateRange(timeRange);
    const params = { start: range.start, end: range.end };
    try {
      const [bp, bm] = await Promise.all([api.getByProvider(params), api.getByModel(params)]);
      setByProvider(bp);
      setByModel(bm);
    } catch (err) {
      console.error('Failed to fetch breakdown:', err);
    }
  }, [timeRange]);

  // Fetch filtered stats
  const fetchFiltered = useCallback(async () => {
    const range = getDateRange(timeRange);
    const params: Record<string, string> = { start: range.start, end: range.end };

    // Build filter params
    if (activeModelIds.size > 0) {
      // Use specific model IDs
      params.models = Array.from(activeModelIds).join(',');
    } else if (selectedProvider) {
      params.provider = selectedProvider;
    }

    try {
      const trendPromise = timeRange === '24h' ? api.getHourly(params) : api.getDaily(params);
      const [ov, trend] = await Promise.all([api.getOverview(params), trendPromise]);
      setOverview(ov);
      setChartData(timeRange === '24h' ? fillHourlyGaps(trend, range.start) : trend);
    } catch (err) {
      console.error('Failed to fetch filtered data:', err);
    }
  }, [timeRange, selectedProvider, activeModelIds]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchBreakdown(), fetchFiltered()]).finally(() => setLoading(false));
  }, [timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // On filter change: only refetch stats, no spinner
  useEffect(() => {
    if (!isFilterChange.current) {
      isFilterChange.current = true;
      return;
    }
    fetchFiltered();
  }, [selectedProvider, activeModelIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncNow();
      setFilterOptions(await api.getFilters());
      await Promise.all([fetchBreakdown(), fetchFiltered()]);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const clearAll = () => {
    setSelectedProvider('');
    setActiveModelIds(new Set());
  };

  // Provider click
  const handleProviderSelect = (id: string) => {
    if (id === selectedProvider) {
      // Deselect provider → clear everything
      clearAll();
    } else {
      // Select provider → highlight it, activate all its models
      setSelectedProvider(id);
      setActiveModelIds(new Set()); // empty = "all models of this provider"
    }
  };

  // Model click: toggle a model's highlight
  const handleModelToggle = (modelId: string) => {
    const providerModelIds = selectedProvider ? getProviderModelIds(selectedProvider) : new Set<string>();

    if (!selectedProvider) {
      // No provider selected: clicking a model selects its provider + that model only
      const model = byModel.find((m) => String(m.model_id) === modelId);
      if (model) {
        const provider = byProvider.find((p) => String(p.provider_name) === String(model.provider_name));
        if (provider) {
          setSelectedProvider(String(provider.provider_id));
          setActiveModelIds(new Set([modelId]));
        }
      }
      return;
    }

    // Provider is selected
    let currentActive: Set<string>;
    if (activeModelIds.size === 0) {
      // "All models active" → start from full set
      currentActive = new Set(providerModelIds);
    } else {
      currentActive = new Set(activeModelIds);
    }

    if (currentActive.has(modelId)) {
      // Deselect this model
      currentActive.delete(modelId);
      if (currentActive.size === 0) {
        // Last model deselected → clear all filters
        clearAll();
        return;
      }
    } else {
      // Re-activate this model
      currentActive.add(modelId);
      // If all models are now active again, simplify to "all"
      if (providerModelIds.size > 0 && currentActive.size === providerModelIds.size) {
        setActiveModelIds(new Set());
        return;
      }
    }

    setActiveModelIds(new Set(currentActive));
  };

  // Determine highlight states
  const providerModelIds = selectedProvider ? getProviderModelIds(selectedProvider) : new Set<string>();
  const effectiveActiveModels = activeModelIds.size > 0 ? activeModelIds : providerModelIds;

  const isModelHighlighted = (modelId: string): boolean => {
    if (!selectedProvider) return false;
    return effectiveActiveModels.has(modelId);
  };

  // Also highlight provider from model's perspective
  const highlightedProviderFromModel = (): string => {
    if (selectedProvider) return selectedProvider;
    return '';
  };

  const totalRequests = overview?.total_requests ?? 0;
  const errorCount = overview?.error_count ?? 0;
  const successRate = totalRequests > 0 ? formatPercent(totalRequests - errorCount, totalRequests) : '0%';
  const hasFilter = selectedProvider !== '' || activeModelIds.size > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-4">
          <div className="flex items-center justify-between h-11">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-orange-500 rounded flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-bold text-gray-800">{t(locale, 'app.title')}</span>
              {hasFilter && (
                <button onClick={clearAll} className="text-[10px] text-orange-500 hover:text-orange-700 ml-2 border border-orange-200 rounded px-1.5 py-0.5 bg-orange-50">
                  {t(locale, 'filter.clear')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <TimeRangeSelector value={timeRange} onChange={setTimeRange} locale={locale} />
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-orange-600 border border-gray-200 rounded-md hover:border-orange-300 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {t(locale, 'app.sync')}
              </button>
              <button
                onClick={toggleLocale}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded transition"
              >
                <Globe className="w-3 h-3" />
                {locale === 'en' ? '中文' : 'EN'}
              </button>
              <span className="text-xs text-gray-400">{username}</span>
              <button onClick={onLogout} className="p-1 hover:bg-gray-100 rounded transition" title={t(locale, 'app.logout')}>
                <LogOut className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-6 h-6 text-orange-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* Request Stats */}
            <section>
              <h2 className="text-xs font-medium text-gray-400 mb-1.5">{t(locale, 'section.requests')}</h2>
              <div className="grid grid-cols-3 gap-2">
                <StatsCard title={t(locale, 'stat.totalRequests')} value={formatNumber(totalRequests)} />
                <StatsCard title={t(locale, 'stat.errors')} value={formatNumber(errorCount)} accent="red" />
                <StatsCard title={t(locale, 'stat.successRate')} value={successRate} accent="green" />
              </div>
            </section>

            {/* Token Stats */}
            <section>
              <h2 className="text-xs font-medium text-gray-400 mb-1.5">{t(locale, 'section.tokens')}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                <StatsCard title={t(locale, 'stat.tokenIO')} value={`${formatTokens(overview?.total_input_tokens)} / ${formatTokens(overview?.total_output_tokens)}`} />
                <StatsCard title={t(locale, 'stat.cacheIO')} value={`${formatTokens(overview?.total_cache_input_tokens)} / ${formatTokens(overview?.total_cache_output_tokens)}`} />
                <StatsCard title={t(locale, 'stat.outputTps')} value={totalRequests > 0 ? formatNumber(Math.round((overview?.total_output_tokens ?? 0) / totalRequests)) : '0'} subtitle={t(locale, 'stat.outputTps.sub')} />
                <StatsCard title={t(locale, 'stat.totalCost')} value={formatCost(overview?.total_cost)} accent="orange" />
                <StatsCard title={t(locale, 'stat.avgCost')} value={totalRequests > 0 ? formatCost((overview?.total_cost ?? 0) / totalRequests) : '$0'} />
              </div>
            </section>

            {/* Charts */}
            <section>
              <h2 className="text-xs font-medium text-gray-400 mb-1.5">{t(locale, 'section.trend')}</h2>
              <div className="space-y-2">
                <TokenChart data={chartData as Record<string, string | number>[]} xKey={timeRange === '24h' ? 'hour' : 'date'} title={t(locale, timeRange === '24h' ? 'chart.token.hourly' : 'chart.token')} locale={locale} />
                <CostChart data={chartData as Record<string, string | number>[]} xKey={timeRange === '24h' ? 'hour' : 'date'} title={t(locale, timeRange === '24h' ? 'chart.cost.hourly' : 'chart.cost')} locale={locale} />
              </div>
            </section>

            {/* Provider & Model Breakdown */}
            <section>
              <div className="grid grid-cols-1 lg:grid-cols-10 gap-2">
                <div className="lg:col-span-3">
                  <ProviderBreakdown
                    data={byProvider as Array<{ provider_id: number; provider_name: string; provider_type: string; requests: number; input_tokens: number; output_tokens: number; cost: number; }>}
                    locale={locale}
                    selectedId={highlightedProviderFromModel()}
                    onSelect={handleProviderSelect}
                  />
                </div>

                <div className="lg:col-span-7">
                  <ModelBreakdown
                    data={byModel as unknown as ModelStats[]}
                    locale={locale}
                    isHighlighted={isModelHighlighted}
                    onToggle={handleModelToggle}
                  />
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
