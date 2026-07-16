import { clsx } from 'clsx';
import type { TimeRange } from '@/types';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

interface Props {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  locale: Locale;
}

export default function TimeRangeSelector({ value, onChange, locale }: Props) {
  const options: { label: string; value: TimeRange }[] = [
    { label: t(locale, 'time.24h'), value: '24h' },
    { label: t(locale, 'time.7d'), value: '7d' },
    { label: t(locale, 'time.30d'), value: '30d' },
    { label: t(locale, 'time.180d'), value: '180d' },
    { label: t(locale, 'time.365d'), value: '365d' },
  ];

  return (
    <div className="flex bg-gray-100 rounded-md p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'px-3 py-1 text-xs rounded transition font-medium',
            value === opt.value
              ? 'bg-white text-gray-800 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
