'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Globe,
  Info,
  Laptop,
  Moon,
  Settings,
  SlidersHorizontal,
  Timer,
  Sun,
  Volume2,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import { usePreferencesStore } from '@/modules/preferences/preferences.store';
import { useT } from '@/lib/i18n';
import type {
  LanguagePreference,
  MinSeverityPreference,
  SessionTimeoutPreference,
  ThemePreference,
  UserPreferences,
} from '@/modules/preferences/preferences.types';

// ─── Controles ────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-cyan-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

interface ToggleRowProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ icon: Icon, title, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Icon size={16} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: ThemePreference; label: string; description: string; icon: typeof Sun }[] = [
  { value: 'light',  label: 'Claro',   description: 'Fundo claro, ideal para ambientes iluminados', icon: Sun },
  { value: 'dark',   label: 'Escuro',  description: 'Reduz o brilho em salas de operação',           icon: Moon },
  { value: 'system', label: 'Sistema', description: 'Acompanha o tema do seu dispositivo',           icon: Laptop },
];

const SEVERITY_OPTIONS: { value: MinSeverityPreference; label: string; hint: string }[] = [
  { value: 'LOW',    label: 'Todas',           hint: 'Baixa, média e alta' },
  { value: 'MEDIUM', label: 'Média ou maior',  hint: 'Oculta alarmes de severidade baixa' },
  { value: 'HIGH',   label: 'Somente alta',    hint: 'Apenas alarmes críticos' },
];

const SESSION_TIMEOUT_OPTIONS: { value: Exclude<SessionTimeoutPreference, null>; label: string }[] = [
  { value: 15,      label: '15 minutos' },
  { value: 30,      label: '30 minutos' },
  { value: 60,      label: '1 hora' },
  { value: 240,     label: '4 horas' },
  { value: 480,     label: '8 horas' },
  { value: 'never', label: 'Nunca expirar' },
];

const LANGUAGE_OPTIONS: { value: LanguagePreference; label: string }[] = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en',    label: 'English' },
];

export default function PreferencesPage() {
  const t = useT();
  const preferences = usePreferencesStore((s) => s.preferences);
  const updatePreferences = usePreferencesStore((s) => s.updatePreferences);

  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  async function save(patch: Partial<UserPreferences>) {
    const ok = await updatePreferences(patch);
    setFeedback(ok ? 'saved' : 'error');
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2500);
  }

  const notif = preferences.notifications;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
            <Settings className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {t('Configurações da conta')}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('Preferências pessoais de aparência, notificações e idioma')}
            </p>
          </div>
        </div>
        {feedback === 'saved' && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('Salvo')}
          </span>
        )}
        {feedback === 'error' && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-3.5 w-3.5" />
            {t('Não foi possível salvar')}
          </span>
        )}
      </header>

      {/* ── Aparência ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sun className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            {t('Aparência')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('Tema da interface em todo o aplicativo')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = preferences.theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => void save({ theme: opt.value })}
                aria-pressed={active}
                className={`flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500 dark:bg-cyan-950/40'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                <Icon
                  size={18}
                  strokeWidth={1.5}
                  className={active ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'}
                />
                <span
                  className={`text-sm font-medium ${
                    active ? 'text-cyan-700 dark:text-cyan-300' : 'text-foreground'
                  }`}
                >
                  {t(opt.label)}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">{t(opt.description)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Notificações ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bell className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            {t('Notificações')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('O que aparece no sino de notificações')}</p>
        </div>

        <div className="divide-y divide-border">
          <ToggleRow
            icon={WifiOff}
            title={t('Dispositivos offline')}
            description={t('Avisar quando um equipamento perder comunicação')}
            checked={notif.offlineEnabled}
            onChange={(v) => void save({ notifications: { ...notif, offlineEnabled: v } })}
          />
          <ToggleRow
            icon={Info}
            title={t('Avisos de automação')}
            description={t('Mensagens geradas por regras de automação (NOTIFY)')}
            checked={notif.automationEnabled}
            onChange={(v) => void save({ notifications: { ...notif, automationEnabled: v } })}
          />
          <ToggleRow
            icon={Volume2}
            title={t('Som de notificação')}
            description={t('Tocar um alerta sonoro quando um novo alarme chegar')}
            checked={notif.soundEnabled}
            onChange={(v) => void save({ notifications: { ...notif, soundEnabled: v } })}
          />

          {/* Severidade mínima */}
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <SlidersHorizontal size={16} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t('Severidade mínima dos alarmes')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('Alarmes abaixo desta severidade não aparecem no sino')}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SEVERITY_OPTIONS.map((opt) => {
                const active = notif.minSeverity === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => void save({ notifications: { ...notif, minSeverity: opt.value } })}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500 dark:bg-cyan-950/40'
                        : 'border-border hover:bg-muted/40'
                    }`}
                  >
                    <span
                      className={`block text-xs font-semibold ${
                        active ? 'text-cyan-700 dark:text-cyan-300' : 'text-foreground'
                      }`}
                    >
                      {t(opt.label)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{t(opt.hint)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {(!notif.offlineEnabled || !notif.automationEnabled) && (
          <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
            <BellOff size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('Avisos desligados deixam de aparecer no sino, mas os alarmes continuam registrados no painel de alarmes normalmente.')}
            </p>
          </div>
        )}
      </section>

      {/* ── Sessão ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Timer className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            {t('Sessão')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('Tempo de inatividade até o encerramento automático da sessão')}
          </p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SESSION_TIMEOUT_OPTIONS.map((opt) => {
              const active =
                preferences.sessionTimeoutMinutes === opt.value ||
                (preferences.sessionTimeoutMinutes === null && opt.value === 30);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => void save({ sessionTimeoutMinutes: opt.value })}
                  aria-pressed={active}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-cyan-500 bg-cyan-50 font-medium text-cyan-700 ring-1 ring-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-300'
                      : 'border-border text-foreground hover:bg-muted/40'
                  }`}
                >
                  {t(opt.label)}
                </button>
              );
            })}
          </div>
          {preferences.sessionTimeoutMinutes === 'never' && (
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              {t('Com "Nunca expirar", sua sessão permanece ativa até você sair manualmente.')}
            </p>
          )}
        </div>
      </section>

      {/* ── Idioma ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Globe className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            {t('Idioma')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('Idioma preferido da interface')}</p>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = preferences.language === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => void save({ language: opt.value })}
                  aria-pressed={active}
                  className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                    active
                      ? 'border-cyan-500 bg-cyan-50 font-medium text-cyan-700 ring-1 ring-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-300'
                      : 'border-border text-foreground hover:bg-muted/40'
                  }`}
                >
                  {opt.label}
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-cyan-600 dark:bg-cyan-400" />}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
