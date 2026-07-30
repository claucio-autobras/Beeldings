// ─── Preferências pessoais do usuário ────────────────────────────────────────
// Espelho do schema do backend (users.preferences). O backend sanitiza e
// mescla com defaults; aqui mantemos o mesmo shape + defaults para cache local.

export type ThemePreference = 'light' | 'dark' | 'system';
export type LanguagePreference = 'pt-BR' | 'en';
export type MinSeverityPreference = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Tempo de inatividade da sessão em minutos, 'never' para nunca expirar, ou
 * null para usar o padrão do ambiente (comportamento legado de 30 min).
 */
export type SessionTimeoutPreference = 15 | 30 | 60 | 240 | 480 | 'never' | null;

export const SESSION_TIMEOUT_VALUES: Exclude<SessionTimeoutPreference, null>[] = [
  15, 30, 60, 240, 480, 'never',
];

export interface NotificationPreferences {
  /** Mostrar avisos de dispositivos offline no sino. */
  offlineEnabled: boolean;
  /** Mostrar avisos de automação (NOTIFY) no sino. */
  automationEnabled: boolean;
  /** Severidade mínima dos alarmes exibidos no sino. */
  minSeverity: MinSeverityPreference;
  /** Tocar som ao chegar um novo alarme. */
  soundEnabled: boolean;
}

export interface UserPreferences {
  theme: ThemePreference;
  language: LanguagePreference;
  notifications: NotificationPreferences;
  /**
   * Tempo de inatividade até o logout automático. null = padrão do ambiente;
   * 'never' desativa o logout por inatividade.
   */
  sessionTimeoutMinutes: SessionTimeoutPreference;
  /**
   * Notificações do sino dispensadas (chave estável → epoch ms da dispensa).
   * A chave inclui o timestamp da última atividade, então uma reativação/nova
   * ocorrência gera chave nova e a notificação volta a aparecer.
   */
  dismissedNotifications: Record<string, number>;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  language: 'pt-BR',
  notifications: {
    offlineEnabled: true,
    automationEnabled: true,
    minSeverity: 'LOW',
    soundEnabled: true,
  },
  sessionTimeoutMinutes: null,
  dismissedNotifications: {},
};

// Espelho da higiene do backend: expira em 30 dias, no máximo 500 entradas.
const DISMISSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISMISSED_MAX_ENTRIES = 500;

/** Valida, expira e limita o mapa de notificações dispensadas. */
export function sanitizeDismissed(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const now = Date.now();
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((e): e is [string, number] =>
      typeof e[0] === 'string' && e[0].length > 0 &&
      typeof e[1] === 'number' && Number.isFinite(e[1]) &&
      now - e[1] < DISMISSED_TTL_MS,
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, DISMISSED_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

/** Ordem crescente de severidade para o filtro de severidade mínima. */
export const SEVERITY_ORDER: Record<MinSeverityPreference, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

/** Mescla JSON parcial/desconhecido com os defaults (defensivo). */
export function mergePreferences(raw: unknown): UserPreferences {
  const d = DEFAULT_PREFERENCES;
  if (!raw || typeof raw !== 'object') {
    return { ...d, notifications: { ...d.notifications }, sessionTimeoutMinutes: d.sessionTimeoutMinutes };
  }
  const r = raw as Partial<UserPreferences> & { notifications?: Partial<NotificationPreferences> };
  return {
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'system' ? r.theme : d.theme,
    language: r.language === 'pt-BR' || r.language === 'en' ? r.language : d.language,
    notifications: {
      offlineEnabled:
        typeof r.notifications?.offlineEnabled === 'boolean'
          ? r.notifications.offlineEnabled
          : d.notifications.offlineEnabled,
      automationEnabled:
        typeof r.notifications?.automationEnabled === 'boolean'
          ? r.notifications.automationEnabled
          : d.notifications.automationEnabled,
      minSeverity:
        r.notifications?.minSeverity === 'LOW' ||
        r.notifications?.minSeverity === 'MEDIUM' ||
        r.notifications?.minSeverity === 'HIGH'
          ? r.notifications.minSeverity
          : d.notifications.minSeverity,
      soundEnabled:
        typeof r.notifications?.soundEnabled === 'boolean'
          ? r.notifications.soundEnabled
          : d.notifications.soundEnabled,
    },
    sessionTimeoutMinutes:
      r.sessionTimeoutMinutes === null ||
      SESSION_TIMEOUT_VALUES.includes(
        r.sessionTimeoutMinutes as Exclude<SessionTimeoutPreference, null>,
      )
        ? (r.sessionTimeoutMinutes as SessionTimeoutPreference)
        : d.sessionTimeoutMinutes,
    dismissedNotifications: sanitizeDismissed(
      (r as { dismissedNotifications?: unknown }).dismissedNotifications,
    ),
  };
}
