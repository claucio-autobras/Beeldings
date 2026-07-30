'use client';

import { create } from 'zustand';
import { apiGet, apiPatch } from '@/lib/api-client';
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  sanitizeDismissed,
  type ThemePreference,
  type UserPreferences,
} from './preferences.types';

export const PREFS_KEY = 'bluebee_prefs';
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

// ─── Cache local (resposta instantânea + no-flash do tema) ───────────────────

export function readCachedPreferences(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return mergePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function cachePreferences(prefs: UserPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage cheio/indisponível — segue sem cache
  }
}

export function clearCachedPreferences(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PREFS_KEY);
}

// ─── Aplicação do tema no <html> ──────────────────────────────────────────────

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Rotas públicas (login, recuperação de senha) renderizam SEMPRE no tema claro.
 * Mantido em sincronia com o script inline do root layout e o layout público.
 */
export const PUBLIC_ROUTE_RE = /^\/(login|forgot-password|reset-password)(\/|$)/;

export function isPublicRoute(pathname?: string): boolean {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return PUBLIC_ROUTE_RE.test(path);
}

export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  if (isPublicRoute()) {
    // Rotas públicas são sempre claras — não reaplicar o tema salvo aqui.
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    return;
  }
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface PreferencesState {
  preferences: UserPreferences;
  /** true depois que o cache local foi lido (evita piscar defaults). */
  hydrated: boolean;
  /** Hidrata do cache local e aplica o tema imediatamente. */
  hydrate: () => void;
  /** Substitui tudo (ex.: payload do login ou do GET) e aplica/salva localmente. */
  setPreferences: (prefs: UserPreferences) => void;
  /** Busca do backend e sincroniza (silencioso em caso de falha de rede). */
  syncFromServer: () => Promise<void>;
  /**
   * Atualização otimista: aplica local + tema na hora e persiste no backend.
   * Retorna false se o backend rejeitar (estado é revertido para o do servidor).
   */
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<boolean>;
  /**
   * Registra notificações do sino como dispensadas (persistente por usuário).
   * Otimista: aplica local na hora e envia o mapa completo ao backend.
   */
  dismissNotifications: (keys: string[]) => Promise<boolean>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  hydrated: false,

  hydrate: () => {
    const cached = readCachedPreferences();
    applyTheme(cached.theme);
    set({ preferences: cached, hydrated: true });
  },

  setPreferences: (prefs) => {
    const merged = mergePreferences(prefs);
    cachePreferences(merged);
    applyTheme(merged.theme);
    set({ preferences: merged, hydrated: true });
  },

  syncFromServer: async () => {
    if (USE_MOCK) return; // modo demonstração: só cache local
    try {
      const prefs = await apiGet<UserPreferences>('/account/preferences');
      get().setPreferences(prefs);
    } catch {
      // offline/token expirado — mantém o cache local
    }
  },

  updatePreferences: async (patch) => {
    const before = get().preferences;
    const optimistic = mergePreferences({
      ...before,
      ...patch,
      notifications: { ...before.notifications, ...(patch.notifications ?? {}) },
    });
    get().setPreferences(optimistic);

    if (USE_MOCK) return true; // modo demonstração: persiste só localmente

    try {
      const saved = await apiPatch<UserPreferences>('/account/preferences', patch);
      get().setPreferences(saved);
      return true;
    } catch {
      get().setPreferences(before);
      return false;
    }
  },

  dismissNotifications: async (keys) => {
    if (keys.length === 0) return true;
    const now = Date.now();
    const merged = sanitizeDismissed({
      ...get().preferences.dismissedNotifications,
      ...Object.fromEntries(keys.map((k) => [k, now])),
    });
    return get().updatePreferences({ dismissedNotifications: merged });
  },
}));

/** Atalho para o conjunto de chaves de notificações dispensadas. */
export function useDismissedNotifications() {
  return usePreferencesStore((s) => s.preferences.dismissedNotifications);
}

/** Atalho para as preferências de notificação (sino). */
export function useNotificationPreferences() {
  return usePreferencesStore((s) => s.preferences.notifications);
}
