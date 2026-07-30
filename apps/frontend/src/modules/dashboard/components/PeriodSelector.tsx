'use client';

import type { DashboardPeriod } from '../services/dashboard.service';

export const PERIOD_OPTIONS: { key: DashboardPeriod; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
];

export const PERIOD_WINDOW_MS: Record<DashboardPeriod, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

interface PeriodSelectorProps {
  value: DashboardPeriod;
  onChange: (period: DashboardPeriod) => void;
}

/** Seletor 24h/7d/30d do topo do dashboard — afeta gráfico e métricas de período. */
export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
      {PERIOD_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            value === key
              ? 'bg-cyan-600 text-white'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
