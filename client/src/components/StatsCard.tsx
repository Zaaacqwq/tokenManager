import { clsx } from 'clsx';

interface Props {
  title: string;
  value: string;
  subtitle?: string;
  accent?: 'default' | 'red' | 'green' | 'orange';
}

export default function StatsCard({ title, value, subtitle, accent = 'default' }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-400 mb-0.5">{title}</p>
      <p
        className={clsx(
          'text-lg font-bold leading-tight',
          accent === 'red' && 'text-red-500',
          accent === 'green' && 'text-emerald-600',
          accent === 'orange' && 'text-orange-500',
          accent === 'default' && 'text-gray-900'
        )}
      >
        {value}
      </p>
      {subtitle && <p className="text-[11px] text-gray-400">{subtitle}</p>}
    </div>
  );
}
