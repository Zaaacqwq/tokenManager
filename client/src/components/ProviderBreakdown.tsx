import { formatTokens, formatCost, formatNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

interface ProviderData {
  provider_id?: number;
  provider_name: string;
  provider_type: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

interface Props {
  data: ProviderData[];
  locale: Locale;
  selectedId?: string;
  onSelect?: (id: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  anthropic: 'bg-amber-100 text-amber-700',
  openai: 'bg-emerald-100 text-emerald-700',
  openclaw: 'bg-violet-100 text-violet-700',
  google: 'bg-blue-100 text-blue-700',
};

const BAR_COLORS: Record<string, string> = {
  anthropic: 'bg-amber-400',
  openai: 'bg-emerald-400',
  openclaw: 'bg-violet-400',
  google: 'bg-blue-400',
};

export default function ProviderBreakdown({ data, locale, selectedId, onSelect }: Props) {
  if (!data.length) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-xs font-medium text-gray-500 mb-3">{t(locale, 'section.provider')}</h3>
        <p className="text-gray-400 text-xs">{t(locale, 'chart.noData')}</p>
      </div>
    );
  }

  const totalCost = data.reduce((sum, d) => sum + (d.cost || 0), 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-gray-500">{t(locale, 'section.provider')}</h3>
        {selectedId && (
          <button onClick={() => onSelect?.('')} className="text-[10px] text-gray-400 hover:text-gray-600 transition">
            {t(locale, 'filter.clear')}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {data.map((provider) => {
          const id = String(provider.provider_id ?? '');
          const isHighlighted = selectedId === id;
          const pct = totalCost > 0 ? ((provider.cost || 0) / totalCost) * 100 : 0;

          return (
            <div
              key={provider.provider_name}
              onClick={() => onSelect?.(isHighlighted ? '' : id)}
              className={`rounded-md px-2.5 py-2 cursor-pointer transition-colors space-y-1 ${
                isHighlighted
                  ? 'bg-orange-50 ring-1 ring-orange-200'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`font-medium text-xs ${isHighlighted ? 'text-orange-700' : 'text-gray-800'}`}>
                    {provider.provider_name}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[provider.provider_type] || 'bg-gray-100 text-gray-600'}`}>
                    {provider.provider_type}
                  </span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{formatCost(provider.cost)}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${BAR_COLORS[provider.provider_type] || 'bg-gray-400'}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <div className="flex gap-3 text-[11px] text-gray-400">
                <span>{formatNumber(provider.requests)} {t(locale, 'provider.requests')}</span>
                <span>{t(locale, 'provider.in')}: {formatTokens(provider.input_tokens)}</span>
                <span>{t(locale, 'provider.out')}: {formatTokens(provider.output_tokens)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
