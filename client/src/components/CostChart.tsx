import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCost } from '@/lib/format';
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

export default function CostChart({ data, xKey, title, locale }: Props) {
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
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={(v: string) => v.replace(/^\d{4}-/, '')} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCost(v)} width={60} />
          <Tooltip
            contentStyle={{ borderRadius: '6px', border: '1px solid #e5e7eb', boxShadow: '0 2px 4px rgba(0,0,0,0.08)', fontSize: '12px', padding: '6px 10px' }}
            formatter={(value: number) => [formatCost(value), t(locale, 'legend.cost')]}
          />
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="cost" stroke="#f97316" strokeWidth={1.5} fill="url(#costGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
