import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatTokens, formatCost, formatNumber } from '@/lib/format';
import type { ModelStats } from '@/types';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

type SortKey = 'requests' | 'input_tokens' | 'output_tokens' | 'cache_input_tokens' | 'cache_output_tokens' | 'cost';
type SortDir = 'asc' | 'desc';

interface Props {
  data: ModelStats[];
  locale: Locale;
  isHighlighted: (modelId: string) => boolean;
  onToggle: (modelId: string) => void;
}

export default function ModelBreakdown({ data, locale, isHighlighted, onToggle }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    const factor = sortDir === 'desc' ? -1 : 1;
    return [...data].sort((a, b) => factor * ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)));
  }, [data, sortKey, sortDir]);

  const totalCost = useMemo(() => data.reduce((sum, m) => sum + (m.cost ?? 0), 0), [data]);

  const columns: { key: SortKey; label: string }[] = [
    { key: 'requests', label: t(locale, 'table.requests') },
    { key: 'input_tokens', label: t(locale, 'table.input') },
    { key: 'output_tokens', label: t(locale, 'table.output') },
    { key: 'cache_input_tokens', label: t(locale, 'table.cacheRead') },
    { key: 'cache_output_tokens', label: t(locale, 'table.cacheWrite') },
    { key: 'cost', label: t(locale, 'table.cost') },
  ];

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-xs font-medium text-gray-500 mb-2">{t(locale, 'section.model')}</h3>
        <p className="text-gray-400 text-xs">{t(locale, 'chart.noData')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-xs font-medium text-gray-500 mb-2">{t(locale, 'section.model')}</h3>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left text-gray-400 border-b border-gray-100">
              <th className="pb-1.5 font-medium">{t(locale, 'table.model')}</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="pb-1.5 font-medium text-right cursor-pointer select-none hover:text-gray-600"
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'desc'
                        ? <ChevronDown className="w-3 h-3 text-orange-500" />
                        : <ChevronUp className="w-3 h-3 text-orange-500" />
                    ) : (
                      <span className="w-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const id = String(m.model_id);
              const highlighted = isHighlighted(id);
              const pct = totalCost > 0 ? ((m.cost ?? 0) / totalCost) * 100 : 0;

              return (
                <tr
                  key={id}
                  onClick={() => onToggle(id)}
                  className={`border-b border-gray-50 cursor-pointer transition-colors ${highlighted ? 'bg-orange-50' : 'hover:bg-gray-50/50'}`}
                >
                  <td className="py-2">
                    <div className={`font-medium ${highlighted ? 'text-orange-700' : 'text-gray-800'}`}>
                      {m.model_name}
                      <span className="ml-1 text-[11px] font-normal text-gray-400">({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="text-[11px] text-gray-400">{m.provider_name}</div>
                  </td>
                  <td className="py-2 text-right text-gray-600">{formatNumber(m.requests)}</td>
                  <td className="py-2 text-right text-gray-600">{formatTokens(m.input_tokens)}</td>
                  <td className="py-2 text-right text-gray-600">{formatTokens(m.output_tokens)}</td>
                  <td className="py-2 text-right text-gray-600">{formatTokens(m.cache_input_tokens)}</td>
                  <td className="py-2 text-right text-gray-600">{formatTokens(m.cache_output_tokens)}</td>
                  <td className="py-2 text-right font-medium text-orange-600">{formatCost(m.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
