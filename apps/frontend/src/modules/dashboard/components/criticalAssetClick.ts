/**
 * Regras de clique do card "Ativos Críticos" por perfil e estado (puras, sem
 * router — testáveis):
 * - falha → painel "Primeira ação sugerida" (ambos os perfis);
 * - perfil técnico (ADMIN/CCO/SUPERVISOR) → deep-link direto ao ponto:
 *   detalhe do dispositivo com o ponto em destaque (câmera vai ao CFTV);
 * - cliente → painel informativo do ativo, com atalho contextual apenas
 *   quando faz sentido — NUNCA ao SCADA num item sem resposta (o ponto
 *   estaria mudo lá).
 */

export interface ClickableAsset {
  state: 'fault' | 'no_response' | 'running' | 'stopped' | 'unknown';
  deviceId: string;
  pointId: string | null;
  scadaScreenId: string | null;
  faultAlarmEventId: string | null;
}

export interface ClickContext {
  isAdmin: boolean;
  /** O ativo pertence a uma câmera CFTV (kind camera ou ponto de câmera). */
  isCamera: boolean;
}

export type AssetShortcut = { label: 'cftv' | 'scada'; href: string } | null;

export type AssetClickAction =
  | { kind: 'firstAction' }
  | { kind: 'navigate'; href: string }
  | { kind: 'infoModal'; shortcut: AssetShortcut };

/** Atalho contextual do painel informativo do cliente. */
export function resolveInfoShortcut(a: ClickableAsset, ctx: ClickContext): AssetShortcut {
  if (ctx.isCamera) return { label: 'cftv', href: '/cftv' };
  if (a.scadaScreenId && a.state !== 'no_response') {
    return { label: 'scada', href: `/scada/view/${a.scadaScreenId}` };
  }
  return null;
}

/**
 * Destino da navegação contextual (usado também pelo botão do painel de
 * primeira ação em itens de falha).
 */
export function resolveAssetNavigateHref(a: ClickableAsset, ctx: ClickContext): string {
  if (a.state === 'fault' && a.faultAlarmEventId) {
    return `/alarms?state=open&highlight=${a.faultAlarmEventId}`;
  }
  if (ctx.isCamera) return '/cftv';
  if (ctx.isAdmin) {
    const params = new URLSearchParams({ deviceId: a.deviceId });
    if (a.pointId) params.set('pointId', a.pointId);
    return `/devices?${params.toString()}`;
  }
  if (a.scadaScreenId && a.state !== 'no_response') return `/scada/view/${a.scadaScreenId}`;
  return '/devices';
}

/** Ação do clique num item do card. */
export function resolveAssetClick(a: ClickableAsset, ctx: ClickContext): AssetClickAction {
  if (a.state === 'fault') return { kind: 'firstAction' };
  if (ctx.isAdmin) return { kind: 'navigate', href: resolveAssetNavigateHref(a, ctx) };
  return { kind: 'infoModal', shortcut: resolveInfoShortcut(a, ctx) };
}
