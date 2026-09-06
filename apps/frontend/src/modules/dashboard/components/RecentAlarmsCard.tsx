'use client';

import { useRouter } from 'next/navigation';
import { Bell, CheckCircle2, ChevronRight } from 'lucide-react';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type {
  AlarmEventItem,
  AlarmEventState,
} from '@/modules/alarms/services/alarms-api.service';
import {
  recentAlarmActivityAt,
  recentAlarmSeverityLabel,
} from './recentAlarms.logic';
import { DashboardPanel, DashboardSectionTitle, StatusChip } from './DashboardShared';

interface RecentAlarmsCardProps {
  events: AlarmEventItem[] | undefined;
  isLoading?: boolean;
}

const VISIBLE_ALARMS = 5;

function fmtRelative(iso: string, isEn: boolean): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return isEn ? 'now' : 'agora';
  if (min < 60) return isEn ? `${min} min ago` : `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return isEn ? `${hours}h ago` : `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return isEn ? `${days}d ago` : `há ${days}d`;
}

function isAcknowledged(state: AlarmEventState): boolean {
  return state === 'ACTIVE_ACK';
}

export function RecentAlarmsCard({ events, isLoading }: RecentAlarmsCardProps) {
  const t = useT();
  const router = useRouter();
  const rows = events ?? [];
  const visibleRows = rows.slice(0, VISIBLE_ALARMS);
  const hasMoreRows = rows.length > VISIBLE_ALARMS;
  const isEn = getCurrentLanguage() === 'en';

  const openAlarm = (event: AlarmEventItem) => {
    const params = new URLSearchParams({
      state: 'open',
      severity: event.severity,
      highlight: event.id,
    });
    router.push(`/alarms?${params.toString()}`);
  };

  return (
    <DashboardPanel className="p-5" accent>
      <DashboardSectionTitle
        eyebrow={t('Alarmes Recentes Ativos')}
        title={t('O que precisa de atenção')}
        detail={t('Ocorrências mais recentes e relevantes')}
        action={<Bell className="h-4 w-4 text-red-500" />}
      />

      <div className="mt-4 flex min-h-0 flex-1 flex-col space-y-2.5">
        {isLoading ? (
          <div className="space-y-1.5 animate-pulse" aria-label={t('Carregando alarmes')}>
             {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[74px] rounded-xl bg-muted" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 text-center">
            <CheckCircle2 size={26} strokeWidth={1.5} className="text-emerald-500" />
            <p className="text-sm font-medium text-foreground">{t('Nenhum alarme ativo')}</p>
            <p className="max-w-[240px] text-xs leading-relaxed text-muted-foreground">
              {t('Não há ocorrências ativas neste momento')}
            </p>
          </div>
        ) : (
          visibleRows.map((event) => {
            const ack = isAcknowledged(event.state);
            const pointName = event.objectName || event.tag;
            const title = event.name || event.message || pointName;
            const context = [event.tenantName, event.siteName, pointName].filter(Boolean).join(' · ');
            const activityAt = recentAlarmActivityAt(event);

            const isHigh = event.severity === 'HIGH';
            const isMedium = event.severity === 'MEDIUM';
            const dotClass = isHigh ? "bg-red-500" : isMedium ? "bg-orange-500" : "bg-cyan-500";
            const severityLabel = t(recentAlarmSeverityLabel(event.severity));

            return (
              <article
                key={event.id}
                className={`rounded-xl border p-3 transition-colors ${
                  ack
                    ? "border-emerald-200 bg-emerald-50/60 opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                    : "border-border bg-muted/50 dark:bg-muted"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ack ? "bg-emerald-500" : dotClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2">
                      <p className="flex-1 truncate text-[13px] font-bold text-foreground">{title}</p>
                      <span className="font-mono text-[10px] text-muted-foreground">{fmtRelative(activityAt, isEn)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{context}</p>
                    <div className="mt-2 flex items-center">
                      <StatusChip status={ack ? 'normal' : isHigh ? 'falha' : isMedium ? 'atencao' : 'alerta'}>
                        {ack ? t('Reconhecido') : severityLabel}
                      </StatusChip>
                      <button
                        onClick={() => openAlarm(event)}
                        className="dashboard-clickable ml-auto rounded-md border border-border px-2 py-1 font-mono text-[10px] font-bold uppercase text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      >
                        {t('Abrir')}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {hasMoreRows && (
        <button
          onClick={() => router.push('/alarms?state=open')}
          className="dashboard-clickable mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 font-mono text-[9px] font-bold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {t('ver todos os alarmes')} <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </DashboardPanel>
  );
}