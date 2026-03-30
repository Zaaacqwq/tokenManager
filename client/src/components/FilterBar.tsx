import { ChevronDown, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

interface FilterOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface FilterDropdownProps {
  label: string;
  allLabel: string;
  options: FilterOption[];
  selected: string;
  onChange: (value: string) => void;
}

function FilterDropdown({ label, allLabel, options, selected, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === selected);
  const displayLabel = selected ? selectedOption?.label ?? selected : label;
  const isActive = selected !== '';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border transition ${
          isActive
            ? 'bg-orange-50 border-orange-300 text-orange-700'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        <span className="max-w-[100px] truncate">{displayLabel}</span>
        {isActive ? (
          <X className="w-3 h-3 hover:text-orange-900" onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }} />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md border border-gray-200 shadow-lg z-50 py-0.5 max-h-56 overflow-y-auto">
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-50 transition ${!selected ? 'text-orange-600 font-medium' : 'text-gray-600'}`}
          >
            {allLabel} {label}
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-50 transition ${selected === opt.value ? 'text-orange-600 font-medium bg-orange-50' : 'text-gray-700'}`}
            >
              <div>{opt.label}</div>
              {opt.sublabel && <div className="text-[10px] text-gray-400">{opt.sublabel}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FilterBarProps {
  providers: FilterOption[];
  models: FilterOption[];
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  locale: Locale;
}

export default function FilterBar({
  providers, models, selectedProvider, selectedModel, onProviderChange, onModelChange, locale,
}: FilterBarProps) {
  const allLabel = t(locale, 'filter.all');
  return (
    <div className="flex items-center gap-1.5">
      <FilterDropdown label={t(locale, 'filter.provider')} allLabel={allLabel} options={providers} selected={selectedProvider} onChange={onProviderChange} />
      <FilterDropdown label={t(locale, 'filter.model')} allLabel={allLabel} options={models} selected={selectedModel} onChange={onModelChange} />
    </div>
  );
}
