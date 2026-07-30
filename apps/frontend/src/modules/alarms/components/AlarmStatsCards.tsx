'use client';

import { AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import type { AlarmStats } from '@/modules/alarms/types/alarm.types';
import { useT } from '@/lib/i18n';

interface StatCardProps {
  label: string;
  count: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

function StatCard({ label, count, icon: Icon, colorClass, bgClass, borderClass }: StatCardProps) {
  return (
    <div className={`rounded-lg border p-4 ${bgClass} ${borderClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium ${colorClass}`}>{label}</p>
          <p className={`mt-1 text-2xl font-bold ${colorClass}`}>{count}</p>
        </div>
        <div className={`rounded-md p-1.5 ${bgClass}`}>
          <Icon size={18} strokeWidth={1.5} className={colorClass} />
        </div>
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-3 w-14 rounded bg-muted" />
          <div className="h-7 w-8 rounded bg-muted" />
        </div>
        <div className="h-8 w-8 rounded-md bg-muted" />
      </div>
    </div>
  );
}

interface AlarmStatsCardsProps {
  stats: AlarmStats | undefined;
  isLoading: boolean;
}

export function AlarmStatsCards({ stats, isLoading }: AlarmStatsCardsProps) {
  const t = useT();
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const cards: StatCardProps[] = [
    {
      label: t('Alarmes Ativos'),
      count: stats?.activeCount ?? 0,
      icon: AlertCircle,
      colorClass: 'text-red-700',
      bgClass: 'bg-red-50',
      borderClass: 'border-red-200',
    },
    {
      label: t('Aguardando ACK'),
      count: stats?.pendingAck ?? 0,
      icon: Clock,
      colorClass: 'text-amber-700',
      bgClass: 'bg-amber-50',
      borderClass: 'border-amber-200',
    },
    {
      label: t('Reconhecidos'),
      count: stats?.acknowledgedCount ?? 0,
      icon: CheckCircle2,
      colorClass: 'text-green-700',
      bgClass: 'bg-green-50',
      borderClass: 'border-green-200',
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </div>
  );
}
