'use client';

import { History } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * Caso da memória operacional anônima retornado pelo backend junto às
 * respostas da IA (chat, sugestão por equipamento e primeira ação).
 *
 * LGPD: o caso é 100% anônimo por construção — NUNCA contém tenant, site,
 * cliente, gateway, endereço ou nome de equipamento; apenas o problema
 * (tipo de equipamento, alarme, como foi resolvido e há quanto tempo).
 */
export interface SimilarCaseView {
  caseId: string;
  monitoredDeviceType: string | null;
  protocol: string;
  alarmName: string;
  alarmType: string;
  severity: string;
  valueAtTrigger: number | null;
  recurrenceCount: number;
  timeToResolveMinutes: number | null;
  resolution: string;
  occurredAt: string;
  similarity: number;
}

const TYPE_LABEL: Record<string, string> = {
  CAMERA: 'Câmera',
  SWITCH: 'Switch de rede',
  NVR: 'NVR/DVR',
  ACCESS_CONTROLLER: 'Controladora de acesso',
};

const SEVERITY_LABEL: Record<string, string> = {
  LOW: 'baixa',
  MEDIUM: 'média',
  HIGH: 'alta',
};

/** "há menos de 1 mês" / "há 1 mês" / "há X meses" a partir de uma data ISO. */
function monthsAgoLabel(iso: string, t: (s: string) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const months = Math.max(0, Math.floor(ms / (30 * 24 * 60 * 60 * 1000)));
  if (months <= 0) return t('há menos de 1 mês');
  if (months === 1) return t('há 1 mês');
  return `${t('há')} ${months} ${t('meses')}`;
}

function equipmentLabel(c: SimilarCaseView, t: (s: string) => string): string {
  if (c.monitoredDeviceType) {
    return t(TYPE_LABEL[c.monitoredDeviceType] ?? c.monitoredDeviceType);
  }
  return `${t('Equipamento BMS')} (${c.protocol.toUpperCase()})`;
}

/**
 * Cartões anônimos dos casos semelhantes usados como fonte pela IA — visual
 * distinto das fontes documentais da base de conhecimento (pills cyan): cartão
 * âmbar com ícone de histórico, deixando claro que é a memória operacional
 * anônima do sistema (sem qualquer identificação de cliente/local).
 */
export function SimilarCasesList({ cases }: { cases: SimilarCaseView[] | undefined }) {
  const t = useT();
  if (!cases || cases.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <History size={12} />
        {t('Casos semelhantes já resolvidos (memória anônima do sistema)')}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {cases.map((c, i) => (
          <li
            key={c.caseId}
            className="rounded border border-amber-200/70 bg-card px-2 py-1.5 text-xs text-foreground dark:border-amber-900/60"
          >
            <p className="font-medium">
              {t('Caso')} {i + 1} — {equipmentLabel(c, t)} ·{' '}
              <span className="text-muted-foreground">
                {c.alarmName} ({t('severidade')}{' '}
                {t(SEVERITY_LABEL[c.severity] ?? c.severity)})
              </span>
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {t('Resolvido')}
              {c.timeToResolveMinutes !== null && c.timeToResolveMinutes > 0
                ? ` ${t('em')} ~${c.timeToResolveMinutes} min`
                : ''}{' '}
              · {monthsAgoLabel(c.occurredAt, t)}: <span className="italic">“{c.resolution}”</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {t('Precedentes anônimos registrados na plataforma — sem identificação de cliente ou local.')}
      </p>
    </div>
  );
}
