'use client';

// ─── i18n leve pt-BR → en ─────────────────────────────────────────────────────
// A UI é escrita em pt-BR (idioma padrão). Quando o usuário escolhe "English"
// em /preferences, t() troca cada frase pelo equivalente em inglês via
// dicionário plano pt→en. Frase ausente no dicionário cai no pt-BR (seguro).

import { useCallback } from 'react';
import { usePreferencesStore } from '@/modules/preferences/preferences.store';
import type { LanguagePreference } from '@/modules/preferences/preferences.types';
import { DICT_CORE } from './dictionary.core';
import { DICT_DASHBOARD } from './dictionary.dashboard';
import { DICT_ALARMS } from './dictionary.alarms';
import { DICT_INFRASPEAK } from './dictionary.infraspeak';
import { DICT_REPORTS } from './dictionary.reports';
import { DICT_DEVICES } from './dictionary.devices';
import { DICT_CFTV } from './dictionary.cftv';
import { DICT_SETTINGS } from './dictionary.settings';
import { DICT_SCA } from './dictionary.sca';

const EN: Record<string, string> = {
  ...DICT_CORE,
  ...DICT_DASHBOARD,
  ...DICT_ALARMS,
  ...DICT_INFRASPEAK,
  ...DICT_REPORTS,
  ...DICT_DEVICES,
  ...DICT_CFTV,
  ...DICT_SETTINGS,
  ...DICT_SCA,
};

/** Traduz uma frase pt-BR para o idioma dado (fallback: a própria frase). */
export function translate(lang: LanguagePreference, text: string): string {
  if (lang !== 'en') return text;
  return EN[text] ?? text;
}

/** Idioma atual fora de componentes React (ex.: helpers de formatação). */
export function getCurrentLanguage(): LanguagePreference {
  return usePreferencesStore.getState().preferences.language;
}

/** Hook reativo: re-renderiza quando o idioma muda em /preferences. */
export function useLanguage(): LanguagePreference {
  return usePreferencesStore((s) => s.preferences.language);
}

/** Hook principal: `const t = useT(); t('Alarmes')`. */
export function useT(): (text: string) => string {
  const lang = useLanguage();
  return useCallback((text: string) => translate(lang, text), [lang]);
}
