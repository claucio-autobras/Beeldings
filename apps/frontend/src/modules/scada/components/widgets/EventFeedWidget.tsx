'use client';

import { useEffect, useState } from 'react';
import type { EventFeedWidget } from '../../types/scada.types';
import { dashCardStyle, DashCardTitle, DashBadge, NoData, DASH_SEVERITY_COLOR, DASH_SEVERITY_LABEL, withAlpha } from './dashCard';
import { getAlarmEvents, type AlarmEventItem } from '@/modules/alarms/services/alarms-api.service';

interface Props {
  widget: EventFeedWidget;
  staticRender?: boolean;
  /** Escopo da tela (site/cliente) — injetado pelo renderer. */
  screenScope?: { tenantId?: string | null; siteId?: string | null };
}

const POLL_MS = 15_000;

/** Última atividade do evento (ativação, normalização ou reativação). */
function lastActivity(e: AlarmEventItem): number {
  return Math.max(
    new Date(e.activatedAt).getTime(),
    e.normalizedAt ? new Date(e.normalizedAt).getTime() : 0,
    e.lastReactivatedAt ? new Date(e.lastReactivatedAt).getTime() : 0,
  );
}

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return sameDay ? time : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} ${time}`;
}

const STATIC_ROWS = [
  { sev: 'HIGH', msg: 'Nível baixo — Reservatório 01', when: '10:42' },
  { sev: 'MEDIUM', msg: 'Pressão alta — Bomba B-02', when: '09:57' },
  { sev: 'LOW', msg: 'Sensor restabelecido — T-04', when: '09:10' },
];

/** Feed de eventos/alarmes recentes do site da tela, com severidade colorida. */
export function EventFeedWidgetView({ widget: w, staticRender, screenScope }: Props) {
  const [events, setEvents] = useState<AlarmEventItem[] | null>(null);

  useEffect(() => {
    if (staticRender) return;
    let alive = true;
    async function load() {
      try {
        const list = await getAlarmEvents({
          tenantId: screenScope?.tenantId ?? undefined,
          siteId: screenScope?.siteId ?? undefined,
          severity: w.severity || undefined,
          open: w.onlyActive || undefined,
        });
        if (alive) setEvents(list);
      } catch {
        if (alive) setEvents((prev) => prev ?? null);
      }
    }
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [staticRender, screenScope?.tenantId, screenScope?.siteId, w.severity, w.onlyActive]);

  const rows = (events ?? [])
    .slice()
    .sort((a, b) => lastActivity(b) - lastActivity(a))
    .slice(0, Math.max(1, w.limit));

  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', gap: 8 }}>
      <DashCardTitle text={w.title} color={w.mutedColor} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {staticRender ? (
          STATIC_ROWS.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', opacity: 0.7, borderBottom: i < STATIC_ROWS.length - 1 ? `1px solid ${withAlpha(w.mutedColor, 0.15)}` : 'none' }}>
              <DashBadge color={DASH_SEVERITY_COLOR[r.sev]} text={DASH_SEVERITY_LABEL[r.sev]} />
              <span style={{ fontSize: 11, color: w.textColor, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.msg}</span>
              <span style={{ fontSize: 10, color: w.mutedColor, fontVariantNumeric: 'tabular-nums' }}>{r.when}</span>
            </div>
          ))
        ) : events === null ? (
          <NoData color={w.mutedColor} />
        ) : rows.length === 0 ? (
          <span style={{ fontSize: 11, fontStyle: 'italic', color: w.mutedColor }}>Nenhum evento recente</span>
        ) : (
          rows.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < rows.length - 1 ? `1px solid ${withAlpha(w.mutedColor, 0.15)}` : 'none' }}>
              <DashBadge color={DASH_SEVERITY_COLOR[e.severity] ?? '#64748B'} text={DASH_SEVERITY_LABEL[e.severity] ?? e.severity} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: w.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.message || e.name}
                </span>
                <span style={{ fontSize: 9, color: w.mutedColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.deviceName} · {e.tag}{e.state === 'ACTIVE' || e.state === 'ACTIVE_ACK' ? ' · ativo' : ''}
                </span>
              </div>
              <span style={{ fontSize: 10, color: w.mutedColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtWhen(lastActivity(e))}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
