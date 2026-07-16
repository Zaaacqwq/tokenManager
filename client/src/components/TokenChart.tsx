import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import { formatTokens } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

interface DataPoint {
  [key: string]: string | number;
}

interface Props {
  data: DataPoint[];
  xKey: string;
  title: string;
  locale: Locale;
}

const COLORS = {
  input: '#34d399',
  output: '#60a5fa',
  cache_input: '#fb923c',
  cache_output: '#a78bfa',
  requests: '#f472b6',
};

export default function TokenChart({ data, xKey, title, locale }: Props) {
  const legendMap: Record<string, string> = {
    'Input': t(locale, 'legend.input'),
    'Output': t(locale, 'legend.output'),
    'Cache Input': t(locale, 'legend.cacheInput'),
    'Cache Output': t(locale, 'legend.cacheOutput'),
    'requests': t(locale, 'legend.requests'),
  };

  if (!data.length) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-xs font-medium text-gray-500 mb-2">{title}</h3>
        <div className="h-52 flex items-center justify-center text-gray-400 text-sm">
          {t(locale, 'chart.noData')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-xs font-medium text-gray-500 mb-1">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={(v: string) => v.replace(/^\d{4}-/, '')} />
          <YAxis yAxisId="tokens" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatTokens(v)} width={60} />
          <YAxis yAxisId="requests" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            contentStyle={{ borderRadius: '6px', border: '1px solid #e5e7eb', boxShadow: '0 2px 4px rgba(0,0,0,0.08)', fontSize: '12px', padding: '6px 10px' }}
            formatter={(value: number, name: string) => {
              if (name === 'requests') return [value, legendMap[name]];
              return [formatTokens(value), legendMap[name] || name];
            }}
          />
          <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} formatter={(v: string) => legendMap[v] || v} />
          <Bar yAxisId="tokens" dataKey="input_tokens" name="Input" fill={COLORS.input} radius={[2, 2, 0, 0]} maxBarSize={16} />
          <Bar yAxisId="tokens" dataKey="output_tokens" name="Output" fill={COLORS.output} radius={[2, 2, 0, 0]} maxBarSize={16} />
          <Bar yAxisId="tokens" dataKey="cache_input_tokens" name="Cache Input" fill={COLORS.cache_input} radius={[2, 2, 0, 0]} maxBarSize={16} />
          <Bar yAxisId="tokens" dataKey="cache_output_tokens" name="Cache Output" fill={COLORS.cache_output} radius={[2, 2, 0, 0]} maxBarSize={16} />
          <Line yAxisId="requests" dataKey="requests" name="requests" stroke={COLORS.requests} strokeWidth={1.5} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
