'use client';

import type { EquipmentStateRule } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import { matchRule, withAlpha } from './dashCard';

/**
 * Helpers compartilhados dos cards de controle de clima (equipment-card e
 * climate-card): cabeçalho com indicador + pill de status dirigida por state
 * rules, e formatação de tempo relativo do rodapé.
 */

export interface HeaderStatus {
  /** Cor do indicador/pill; null = sem estado (cinza neutro). */
  color: string | null;
  /** Texto da pill; null = sem pill. */
  text: string | null;
}

/** Resolve o estado do cabeçalho a partir do ponto de status + regras. */
export function resolveHeaderStatus(
  rules: EquipmentStateRule[],
  deviceId: string,
  tag: string,
  getValue: (d: string, t: string) => number | boolean | string | null,
  staticRender: boolean,
): HeaderStatus {
  if (staticRender) {
    const first = rules[0] ?? null;
    return { color: first?.color ?? null, text: first?.text ?? null };
  }
  if (!deviceId || !tag) return { color: null, text: null };
  const raw = getValue(deviceId, tag);
  const rule = matchRule(rules, raw);
  return { color: rule?.color ?? null, text: rule?.text ?? null };
}

/** Pill de status (fundo suave + borda + texto na cor) — estilo da referência. */
export function StatusPill({ color, text }: { color: string; text: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, lineHeight: 1, letterSpacing: '0.06em',
      color, backgroundColor: withAlpha(color, 0.12),
      border: `1px solid ${withAlpha(color, 0.4)}`,
      borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {text}
    </span>
  );
}

/** Cabeçalho comum: indicador redondo + título/subtítulo + pill de status. */
export function ClimateCardHeader({ title, subtitle, status, textColor, mutedColor }: {
  title: string; subtitle: string; status: HeaderStatus; textColor: string; mutedColor: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        backgroundColor: status.color ?? '#475569',
        boxShadow: status.color ? `0 0 6px ${withAlpha(status.color, 0.7)}` : undefined,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 10, color: mutedColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
        )}
      </div>
      {status.text && status.color && <StatusPill color={status.color} text={status.text} />}
    </div>
  );
}

/** Formata número de ponto (null = null; o chamador mostra "sem dados"). */
export function fmtClimateValue(raw: number | boolean | string | null, decimals: number): string | null {
  if (raw === null) return null;
  const n = toScadaNumber(raw);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "há 12s / há 3min / há 2h" a partir de um ISO timestamp; null = null. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  return `há ${h}h`;
}
