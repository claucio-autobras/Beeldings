'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  getAvailabilityPreview,
  type AvailabilityData,
  type AvailabilityRow,
} from '../services/reports.service';

interface AvailabilitySummaryProps {
  tenantId?: string;
  siteId?: string;
  from?: Date;
  to?: Date;
}

/** Mesmo fuso fixo dos relatórios (PDF/CSV), para prévia e arquivo baterem. */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

/** Duração legível: "2d 3h 04min", "58min", "45s". */
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${String(m).padStart(2, '0')}min`);
  return parts.join(' ');
}

function uptimeClass(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground';
  if (pct >= 99) return 'text-emerald-700';
  if (pct >= 95) return 'text-amber-600';
  return 'text-red-600';
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

/**
 * Prévia do Relatório de Disponibilidade: KPIs gerais + tabela por equipamento
 * (pior disponibilidade primeiro). Períodos sem cobertura de dados aparecem
 * como "Sem dados" — nunca 0%/100% enganosos.
 */
export function AvailabilitySummary({ tenantId, siteId, from, to }: AvailabilitySummaryProps) {
  const t = useT();
  const { data, isLoading } = useQuery<AvailabilityData>({
    queryKey: [
      'reports-availability-preview',
      tenantId ?? '',
      siteId ?? '',
      from?.toISOString() ?? '',
      to?.toISOString() ?? '',
    ],
    queryFn: () => getAvailabilityPreview({ tenantId, siteId, from, to }),
  });

  if (isLoading) {
    return (
      <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('Carregando prévia…')}
      </div>
    );
  }

  const rows: AvailabilityRow[] = data?.rows ?? [];
  const s = data?.summary;

  const kindLabel = (k: AvailabilityRow['kind']): string =>
    k === 'gateway' ? t('Gateway') : k === 'camera' ? t('Câmera') : t('Equipamento');

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium text-foreground">
        {t('Prévia')}{' '}
        <span className="text-muted-foreground">
          ({s?.entityCount ?? 0} {t('equipamento(s) no escopo')})
        </span>
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label={t('Uptime médio')}
          value={s?.avgUptimePct == null ? '—' : `${s.avgUptimePct.toFixed(2)}%`}
        />
        <Kpi label={t('Quedas no período')} value={String(s?.totalDrops ?? 0)} />
        <Kpi label={t('Tempo offline total')} value={fmtDuration(s?.totalOfflineMs ?? 0)} />
        <Kpi
          label={t('Sem dados no período')}
          value={String((s?.entityCount ?? 0) - (s?.withDataCount ?? 0))}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-8 text-center text-xs text-muted-foreground">
          {t('Nenhum equipamento no escopo selecionado.')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('Equipamento')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Tipo')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Site')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Disponibilidade')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Quedas')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Tempo offline')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Maior queda')}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t('Cobertura desde')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{kindLabel(r.kind)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.siteName || '—'}</td>
                    <td className={`whitespace-nowrap px-3 py-2 font-tabular font-medium ${uptimeClass(r.uptimePct)}`}>
                      {r.noData || r.uptimePct == null ? t('Sem dados') : `${r.uptimePct.toFixed(2)}%`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-tabular text-muted-foreground">
                      {r.noData ? '—' : r.drops}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-tabular text-muted-foreground">
                      {r.noData ? '—' : fmtDuration(r.offlineMs)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-tabular text-muted-foreground">
                      {r.noData ? '—' : fmtDuration(r.longestOfflineMs)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {r.coverageFrom ? fmtDateTime(r.coverageFrom) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t('O histórico de disponibilidade passa a ser registrado a partir da ativação deste recurso; períodos anteriores aparecem como "Sem dados".')}
      </p>
    </div>
  );
}
