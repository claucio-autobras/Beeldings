// ─── Preferências pessoais do usuário ────────────────────────────────────────
// Persistidas em users.preferences (JSONB). O backend é o dono do schema:
// sanitiza na escrita e mescla com os defaults na leitura, então clientes
// antigos/JSON parcial nunca quebram o frontend.

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
   * Tempo de inatividade até o logout automático. null = padrão do ambiente
   * (comportamento atual); 'never' desativa o logout por inatividade.
   */
  sessionTimeoutMinutes: SessionTimeoutPreference;
  /**
   * Notificações do sino dispensadas pelo usuário (chave estável → epoch ms da
   * dispensa). A chave inclui o timestamp da última atividade da ocorrência,
   * então uma reativação/nova ocorrência gera chave nova e volta a notificar.
   */
  dismissedNotifications: Record<string, number>;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
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

// Higiene do registro de dispensas: expira após 30 dias e mantém no máximo
// 500 entradas (as mais recentes), para o JSONB não crescer indefinidamente.
const DISMISSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISMISSED_MAX_ENTRIES = 500;
const DISMISSED_MAX_KEY_LENGTH = 200;

/** Valida, expira e limita o mapa de notificações dispensadas. */
export function sanitizeDismissedNotifications(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const now = Date.now();
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((e): e is [string, number] =>
      typeof e[0] === 'string' &&
      e[0].length > 0 &&
      e[0].length <= DISMISSED_MAX_KEY_LENGTH &&
      typeof e[1] === 'number' &&
      Number.isFinite(e[1]) &&
      e[1] <= now + 60_000 && // rejeita timestamps futuros (clock skew tolerado)
      now - e[1] < DISMISSED_TTL_MS,
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, DISMISSED_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

const THEMES: ThemePreference[] = ['light', 'dark', 'system'];
const LANGUAGES: LanguagePreference[] = ['pt-BR', 'en'];
const SEVERITIES: MinSeverityPreference[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Valida o timeout de sessão: minutos permitidos, 'never' ou null. */
function sanitizeSessionTimeout(
  value: unknown,
  fallback: SessionTimeoutPreference,
): SessionTimeoutPreference {
  if (value === null) return null;
  if (SESSION_TIMEOUT_VALUES.includes(value as Exclude<SessionTimeoutPreference, null>)) {
    return value as SessionTimeoutPreference;
  }
  return fallback;
}

/**
 * Mescla um JSON arbitrário (vindo do banco ou do cliente) com uma base,
 * descartando valores inválidos campo a campo. A base padrão são os defaults;
 * em atualizações parciais, passe as preferências atuais como base para que
 * campos inválidos preservem o valor atual em vez de voltar ao default.
 */
export function sanitizeUserPreferences(
  raw: unknown,
  base: UserPreferences = DEFAULT_USER_PREFERENCES,
): UserPreferences {
  const d = base;
  if (!raw || typeof raw !== 'object') {
    return {
      ...d,
      notifications: { ...d.notifications },
      sessionTimeoutMinutes: d.sessionTimeoutMinutes,
      dismissedNotifications: sanitizeDismissedNotifications(d.dismissedNotifications),
    };
  }

  const r = raw as Record<string, unknown>;
  const n = (r.notifications && typeof r.notifications === 'object'
    ? r.notifications
    : {}) as Record<string, unknown>;

  return {
    theme: THEMES.includes(r.theme as ThemePreference) ? (r.theme as ThemePreference) : d.theme,
    language: LANGUAGES.includes(r.language as LanguagePreference)
      ? (r.language as LanguagePreference)
      : d.language,
    notifications: {
      offlineEnabled:
        typeof n.offlineEnabled === 'boolean' ? n.offlineEnabled : d.notifications.offlineEnabled,
      automationEnabled:
        typeof n.automationEnabled === 'boolean'
          ? n.automationEnabled
          : d.notifications.automationEnabled,
      minSeverity: SEVERITIES.includes(n.minSeverity as MinSeverityPreference)
        ? (n.minSeverity as MinSeverityPreference)
        : d.notifications.minSeverity,
      soundEnabled:
        typeof n.soundEnabled === 'boolean' ? n.soundEnabled : d.notifications.soundEnabled,
    },
    sessionTimeoutMinutes: sanitizeSessionTimeout(
      'sessionTimeoutMinutes' in r ? r.sessionTimeoutMinutes : d.sessionTimeoutMinutes,
      d.sessionTimeoutMinutes,
    ),
    dismissedNotifications: sanitizeDismissedNotifications(
      'dismissedNotifications' in r ? r.dismissedNotifications : d.dismissedNotifications,
    ),
  };
}
