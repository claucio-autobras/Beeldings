'use client';

import type { DashCardBase, EquipmentStateRule } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';

/**
 * Base visual compartilhada dos widgets estilo dashboard (cards do PDF BlueBee):
 * container de cartão com cores explícitas (funciona sobre fundo claro ou escuro),
 * badge dirigido por state rules e placeholder neutro "sem dados".
 */

export function dashCardStyle(w: DashCardBase): React.CSSProperties {
  return {
    width: '100%', height: '100%', boxSizing: 'border-box',
    backgroundColor: w.backgroundColor,
    border: `1px solid ${w.borderColor}`,
    borderRadius: w.borderRadius,
    color: w.textColor,
    fontFamily: 'Inter, sans-serif',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
  };
}

/** Título pequeno em caps (padrão dos cards do PDF). */
export function DashCardTitle({ text, color }: { text: string; color: string }) {
  if (!text) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

/** Avalia as state rules (valor → cor/texto) — primeira regra que casa vence. */
export function matchRule(rules: EquipmentStateRule[], value: number | boolean | string | null): EquipmentStateRule | null {
  if (value === null) return null;
  const num = toScadaNumber(value);
  if (num === null || Number.isNaN(num)) return null;
  for (const r of rules) {
    const v = r.value;
    const ok = r.operator === 'eq' ? num === v
      : r.operator === 'neq' ? num !== v
      : r.operator === 'gt' ? num > v
      : r.operator === 'lt' ? num < v
      : r.operator === 'gte' ? num >= v
      : r.operator === 'lte' ? num <= v
      : false;
    if (ok) return r;
  }
  return null;
}

/** Badge pílula (fundo suave + texto na cor) no estilo dos cards do PDF. */
export function DashBadge({ color, text }: { color: string; text: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, lineHeight: 1,
      color, backgroundColor: withAlpha(color, 0.14),
      borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {text}
    </span>
  );
}

/** Estado neutro "sem dados" — nunca 0 fake. */
export function NoData({ color, compact = false }: { color: string; compact?: boolean }) {
  return (
    <span style={{ fontSize: compact ? 10 : 11, fontStyle: 'italic', color, opacity: 0.9 }}>
      sem dados
    </span>
  );
}

/** Formata número; null = null (o chamador mostra "sem dados"). */
export function fmtValue(v: number | boolean | string | null, decimals: number): string | null {
  if (v === null) return null;
  const n = toScadaNumber(v);
  if (n === null || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color.slice(1).split('').map((c) => c + c).join('')
      : color.slice(1, 7);
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

export const DASH_SEVERITY_COLOR: Record<string, string> = {
  HIGH: '#EF4444', MEDIUM: '#F59E0B', LOW: '#3B82F6',
};
export const DASH_SEVERITY_LABEL: Record<string, string> = {
  HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa',
};
