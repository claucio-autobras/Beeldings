'use client';

import Link from 'next/link';
import { History } from 'lucide-react';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type { RecentAuditEntry } from '../services/dashboard.service';

interface ActivityFeedCardProps {
  entries: RecentAuditEntry[] | null;
  isLoading?: boolean;
}

function fmtRelative(iso: string): string {
  const en = getCurrentLanguage() === 'en';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return en ? 'just now' : 'agora mesmo';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return en ? `${min} min ago` : `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return en ? `${h} ${h === 1 ? 'hour' : 'hours'} ago` : `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  return en ? `${d} ${d === 1 ? 'day' : 'days'} ago` : `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

/**
 * "Atividade Recente" (visão Admin): timeline da trilha de auditoria real.
 * "Ver tudo" leva ao relatório de auditoria.
 */
export function ActivityFeedCard({ entries, isLoading }: ActivityFeedCardProps) {
  const t = useT();
  const rows = entries ?? [];

  return (
    <div className="flex min-h-[300px] flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-border/60 p-4 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <History size={15} strokeWidth={1.5} className="text-cyan-600" /> {t('Atividade Recente')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('Trilha de auditoria')}</p>
        </div>
        <Link
          href="/reports"
          className="text-xs font-medium text-cyan-700 transition-colors hover:text-cyan-800"
        >
          {t('Ver tudo →')}
        </Link>
      </div>

      <div className="flex-1 p-4">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-8 rounded bg-muted" />
            <div className="h-8 rounded bg-muted" />
            <div className="h-8 rounded bg-muted" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {t('Nenhuma atividade registrada ainda')}
          </p>
        ) : (
          <div className="space-y-4">
            {rows.map((entry, i) => (
              <div key={entry.id} className="relative pl-4">
                {i !== rows.length - 1 && (
                  <div className="absolute bottom-[-16px] left-[5px] top-4 w-px bg-border" />
                )}
                <div
                  className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
                    entry.result === 'FAILURE' ? 'bg-red-500' : 'bg-cyan-500'
                  }`}
                />
                <p className="text-xs leading-tight text-foreground">
                  <span className="font-semibold">{entry.actorName}</span>{' '}
                  <span className="text-muted-foreground">{entry.action}</span>
                  {entry.entityName && (
                    <>
                      {' '}
                      <span className="text-cyan-700">{entry.entityName}</span>
                    </>
                  )}
                  {entry.tenantName && (
                    <span className="text-muted-foreground"> · {entry.tenantName}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                  {fmtRelative(entry.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
