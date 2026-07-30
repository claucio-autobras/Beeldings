'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, Building2, ChevronDown, LogOut,
  MapPin, Menu, PanelLeftClose, PanelLeftOpen,
  Settings, User,
} from 'lucide-react';
import { useCurrentUser, type UserRole } from '@/hooks/useCurrentUser';
import {
  NotificationDrawer,
  type AlarmNotification,
  type AppNotification,
  type OfflineNotification,
} from '@/components/NotificationDrawer';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useAuth } from '@/modules/auth/hooks/use-auth';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import { TenantIdentity } from '@/components/TenantIdentity';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useAcknowledgeAlarm, useAlarms, useMarkNoticesRead } from '@/modules/alarms/hooks/useAlarms';
import { useAlarmRealtime } from '@/modules/alarms/hooks/useAlarmEvents';
import { useDevices } from '@/modules/devices/hooks/useDevices';
import { NewAlarmPopupHost } from '@/components/NewAlarmPopupHost';
import type { Alarm } from '@/modules/alarms/types/alarm.types';
import type { Device } from '@/modules/devices/types/device.types';
import {
  useDismissedNotifications,
  useNotificationPreferences,
  usePreferencesStore,
} from '@/modules/preferences/preferences.store';
import { SEVERITY_ORDER, type NotificationPreferences } from '@/modules/preferences/preferences.types';
import { getCurrentLanguage, translate, useT } from '@/lib/i18n';

// Em modo mock, o pop-up de novo alarme é controlado pelo dashboard (botão de
// simulação). Em produção, o Topbar dispara a partir do socket de alarmes.
const IS_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

interface TenantOption {
  id: string;
  name: string;
  active?: boolean;
  logoUrl?: string | null;
  accentColor?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const roleLabels: Record<UserRole, string> = {
  ADMIN:        'Admin',
  CCO:          'CCO',
  SUPERVISOR:   'Supervisor',
  CLIENTE:      'Cliente',
  VISUALIZADOR: 'Visualizador',
};

// Chaves estáveis de dispensa: incluem o momento da última atividade, então
// uma reativação (alarme) ou uma nova queda (offline) gera chave nova e a
// notificação volta a aparecer mesmo que a anterior tenha sido dispensada.
function alarmDismissKey(a: Alarm): string {
  return a.kind === 'automation'
    ? `notice:${a.id}`
    : `alarm:${a.id}:${a.lastReactivatedAt ?? a.occurredAt}`;
}

function offlineDismissKey(d: Device): string {
  return `offline:${d.id}:${d.lastCommunication ?? 'na'}`;
}

function buildNotifications(
  alarms: Alarm[],
  devices: Device[],
  tenants: TenantOption[],
  tenantId: string | null,
  isAdmin: boolean,
  dismissedKeys: Set<string> = new Set(),
  prefs?: NotificationPreferences,
): AppNotification[] {
  const tenantName = (id: string): string =>
    tenants.find((t) => t.id === id)?.name ?? id;

  const minSeverity = prefs ? SEVERITY_ORDER[prefs.minSeverity] : 0;

  const alarmNotifs: AlarmNotification[] = alarms
    .filter((a) => {
      if (a.status !== 'ALARME') return false;
      if (dismissedKeys.has(alarmDismissKey(a))) return false;
      // Preferências do usuário: avisos de automação desligados e severidade
      // mínima de alarmes (alarme sem severidade conhecida sempre aparece).
      if (a.kind === 'automation') {
        if (prefs && !prefs.automationEnabled) return false;
      } else if (a.severity && SEVERITY_ORDER[a.severity] < minSeverity) {
        return false;
      }
      if (!isAdmin && tenantId) return a.tenantId === tenantId;
      return true;
    })
    .map((a) => {
      const automation = a.kind === 'automation';
      return {
        kind: 'alarm' as const,
        isAutomation: automation,
        sourceId: a.sourceId ?? null,
        id: a.id,
        dismissKey: alarmDismissKey(a),
        tenantId: a.tenantId,
        tenantName: a.tenantName ?? tenantName(a.tenantId),
        title: a.alarmText,
        subtitle: automation
          ? `${translate(getCurrentLanguage(), 'Aviso')} · ${a.sourceName ?? a.deviceName}`
          : `${a.deviceName} · ${a.site}`,
        severity: a.severity,
        occurredAt: a.occurredAt,
      };
    });

  const offlineNotifs: OfflineNotification[] = devices
    .filter((d) => {
      if (prefs && !prefs.offlineEnabled) return false;
      if (d.status !== 'offline') return false;
      if (dismissedKeys.has(offlineDismissKey(d))) return false;
      if (!isAdmin && tenantId) return d.tenantId === tenantId;
      return true;
    })
    .map((d) => ({
      kind: 'offline' as const,
      id: `offline-${d.id}`,
      dismissKey: offlineDismissKey(d),
      tenantId: d.tenantId,
      tenantName: tenantName(d.tenantId),
      title: `${translate(getCurrentLanguage(), 'DISPOSITIVO OFFLINE')} — ${d.name.toUpperCase()}`,
      subtitle: d.site ?? '',
      lastSeen: d.lastCommunication ?? null,
      occurredAt: d.lastCommunication ?? new Date().toISOString(),
    }));

  return [...alarmNotifs, ...offlineNotifs].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

// ─── Tenant Filter Dropdown ───────────────────────────────────────────────────

interface TenantFilterDropdownProps {
  selectedTenantId: string | null;
  tenants: TenantOption[];
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

function TenantFilterDropdown({ selectedTenantId, tenants, onSelect, onClose }: TenantFilterDropdownProps) {
  const t = useT();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute left-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('Filtrar por cliente')}
        </p>
      </div>
      <div className="py-1">
        <button
          type="button"
          onClick={() => { onSelect(null); onClose(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
            selectedTenantId === null
              ? 'bg-cyan-50 text-cyan-700 font-medium dark:text-cyan-300'
              : 'text-foreground hover:bg-muted/40'
          }`}
        >
          <Building2 size={14} strokeWidth={1.5} className={selectedTenantId === null ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'} />
          {t('Todos Clientes')}
          {selectedTenantId === null && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-600" />
          )}
        </button>
        {tenants.map((tenant) => (
          <button
            key={tenant.id}
            type="button"
            onClick={() => { onSelect(tenant.id); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
              selectedTenantId === tenant.id
                ? 'bg-cyan-50 text-cyan-700 font-medium dark:text-cyan-300'
                : 'text-foreground hover:bg-muted/40'
            }`}
          >
            <Building2 size={14} strokeWidth={1.5} className={selectedTenantId === tenant.id ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'} />
            <span className="flex-1 text-left truncate">{tenant.name}</span>
            {tenant.active === false && (
              <span className="shrink-0 rounded-full border border-slate-300 bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {t('Inativo')}
              </span>
            )}
            {selectedTenantId === tenant.id && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-600" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Site Filter Dropdown ─────────────────────────────────────────────────────

interface SiteOption { id: string; name: string }

interface SiteFilterDropdownProps {
  selectedSiteId: string | null;
  sites: SiteOption[];
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

function SiteFilterDropdown({ selectedSiteId, sites, onSelect, onClose }: SiteFilterDropdownProps) {
  const t = useT();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute left-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('Filtrar por site')}
        </p>
      </div>
      <div className="py-1 max-h-72 overflow-y-auto">
        <button
          type="button"
          onClick={() => { onSelect(null); onClose(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
            selectedSiteId === null
              ? 'bg-cyan-50 text-cyan-700 font-medium dark:text-cyan-300'
              : 'text-foreground hover:bg-muted/40'
          }`}
        >
          <MapPin size={14} strokeWidth={1.5} className={selectedSiteId === null ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'} />
          {t('Todos os Sites')}
          {selectedSiteId === null && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-600" />
          )}
        </button>
        {sites.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">{t('Nenhum site cadastrado.')}</p>
        ) : sites.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { onSelect(s.id); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
              selectedSiteId === s.id
                ? 'bg-cyan-50 text-cyan-700 font-medium dark:text-cyan-300'
                : 'text-foreground hover:bg-muted/40'
            }`}
          >
            <MapPin size={14} strokeWidth={1.5} className={selectedSiteId === s.id ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'} />
            <span className="flex-1 text-left truncate">{s.name}</span>
            {selectedSiteId === s.id && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-600" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Topbar Component ─────────────────────────────────────────────────────────

interface TopbarProps {
  onMenuClick: () => void;
  sidebarPinned: boolean;
  onToggleSidebar: () => void;
}

export function Topbar({ onMenuClick, sidebarPinned, onToggleSidebar }: TopbarProps) {
  const t      = useT();
  const user   = useCurrentUser();
  const router = useRouter();
  const { logout } = useAuth();
  const [dropdownOpen,      setDropdownOpen]      = useState(false);
  const [notifOpen,         setNotifOpen]         = useState(false);
  const [tenantFilterOpen,  setTenantFilterOpen]  = useState(false);
  const [siteFilterOpen,    setSiteFilterOpen]    = useState(false);
  // Dispensas locais (chaves) para feedback imediato; a persistência real vive
  // nas preferências do usuário (backend) e sobrevive a refresh/troca de aba.
  const [dismissedLocal,    setDismissedLocal]    = useState<Set<string>>(new Set());
  // Notificações já vistas (persistidas) — controla o pontinho de "não lida".
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('bluebee_notif_read');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  // Pulso do badge do sino quando chega notificação nova.
  const [badgePulse, setBadgePulse] = useState(false);
  const prevNotifCount = useRef<number | null>(null);
  const dropdownRef     = useRef<HTMLDivElement>(null);
  const tenantFilterRef = useRef<HTMLDivElement>(null);
  const siteFilterRef   = useRef<HTMLDivElement>(null);
  const isAdmin  = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const isTenant = !isAdmin;

  // Preferências pessoais do sino (offline, automação, severidade, som).
  const notifPrefs = useNotificationPreferences();
  // Dispensas persistidas por usuário (preferências no backend).
  const dismissedPersisted = useDismissedNotifications();
  const dismissNotifications = usePreferencesStore((s) => s.dismissNotifications);

  // Assinatura global do Socket.IO de alarmes. Vive no Topbar (presente em todas
  // as telas autenticadas), então o sino e o dashboard atualizam em tempo real
  // sem precisar recarregar a página.
  useAlarmRealtime();

  const { selectedTenantId, setTenant } = useTenantFilter();
  const { selectedSiteId, setSite } = useSiteFilter();

  // Admin usa o tenant selecionado globalmente; cliente usa o próprio tenantId
  const effectiveTenantId = isAdmin ? selectedTenantId : user.tenantId;

  // Escopo do seletor de site: admin só vê sites depois de escolher um cliente.
  const siteScopeTenantId = isAdmin ? selectedTenantId : user.tenantId;
  const sites: SiteOption[] = (useSites(siteScopeTenantId ?? undefined).data ?? []).map((s) => ({ id: s.id, name: s.name }));
  // O seletor aparece para clientes sempre; para admin, só quando um cliente está selecionado.
  const showSiteFilter = isTenant || !!selectedTenantId;
  const selectedSiteName = selectedSiteId
    ? (sites.find((s) => s.id === selectedSiteId)?.name ?? null)
    : null;

  // Ao trocar de cliente (admin), zera o site selecionado para não vazar escopo.
  useEffect(() => {
    if (isAdmin) setSite(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  // Permite que o card "Sites" do dashboard abra este seletor.
  useEffect(() => {
    function openSite() {
      if (!showSiteFilter) return;
      setSiteFilterOpen(true);
      setTenantFilterOpen(false);
      setNotifOpen(false);
      setDropdownOpen(false);
    }
    window.addEventListener('bluebee_open_site_filter', openSite);
    return () => window.removeEventListener('bluebee_open_site_filter', openSite);
  }, [showSiteFilter]);

  // Dados reais
  const tenants: TenantOption[] = (useTenants().data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    active: t.active,
    logoUrl: t.logoUrl,
    accentColor: t.accentColor,
  }));
  const alarmsQuery = useAlarms(effectiveTenantId ?? undefined);
  const alarms = alarmsQuery.data ?? [];
  const markNoticesRead = useMarkNoticesRead();
  const acknowledgeAlarm = useAcknowledgeAlarm();
  const devices = useDevices(effectiveTenantId ?? undefined).data ?? [];

  const selectedTenantName = selectedTenantId
    ? (tenants.find((t) => t.id === selectedTenantId)?.name ?? selectedTenantId)
    : null;

  // Identidade do cliente na topbar: cliente logado vê o próprio tenant;
  // admin vê o cliente selecionado no filtro (nada em "Todos os Clientes").
  const identityTenant =
    effectiveTenantId && effectiveTenantId !== '__system__'
      ? tenants.find((t) => t.id === effectiveTenantId) ?? null
      : null;

  const dismissedKeys = new Set<string>([
    ...Object.keys(dismissedPersisted),
    ...dismissedLocal,
  ]);

  const allNotifications = buildNotifications(
    alarms,
    devices,
    tenants,
    effectiveTenantId,
    isAdmin,
    dismissedKeys,
    notifPrefs,
  );

  const activeAlarmCount = allNotifications.length;

  // Não lidas: notificações que ainda não foram vistas com o painel aberto.
  const unreadIds = new Set(allNotifications.filter((n) => !readIds.has(n.id)).map((n) => n.id));

  // Pulso sutil do badge quando o total de notificações aumenta em tempo real.
  useEffect(() => {
    if (prevNotifCount.current !== null && activeAlarmCount > prevNotifCount.current) {
      setBadgePulse(true);
      const timer = setTimeout(() => setBadgePulse(false), 1400);
      prevNotifCount.current = activeAlarmCount;
      return () => clearTimeout(timer);
    }
    prevNotifCount.current = activeAlarmCount;
  }, [activeAlarmCount]);

  // Ao abrir o painel, marca as notificações atuais como vistas (transição
  // suave: o pontinho some após um pequeno atraso, não instantaneamente).
  useEffect(() => {
    if (!notifOpen) return;
    const ids = allNotifications.map((n) => n.id);
    if (ids.every((id) => readIds.has(id))) return;
    const timer = setTimeout(() => {
      setReadIds((prev) => {
        const next = new Set([...prev, ...ids]);
        // Compacta o armazenamento: mantém apenas as últimas ~300 entradas.
        const arr = [...next].slice(-300);
        try { localStorage.setItem('bluebee_notif_read', JSON.stringify(arr)); } catch { /* noop */ }
        return new Set(arr);
      });
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen, allNotifications.length]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (tenantFilterRef.current && !tenantFilterRef.current.contains(e.target as Node)) {
        setTenantFilterOpen(false);
      }
      if (siteFilterRef.current && !siteFilterRef.current.contains(e.target as Node)) {
        setSiteFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  function handleDismiss(id: string) {
    const notif = allNotifications.find((n) => n.id === id);
    if (!notif) return;
    setDismissedLocal((prev) => new Set([...prev, notif.dismissKey]));
    if (notif.kind === 'alarm' && notif.isAutomation) {
      // Avisos de automação já persistem no backend (marcados como lidos).
      markNoticesRead.mutate([id]);
    } else {
      // Alarmes de telemetria e offline: persiste a dispensa nas preferências
      // do usuário — sem ACK, o alarme continua ativo na tela de alarmes.
      void dismissNotifications([notif.dismissKey]);
    }
  }

  function handleClearAll() {
    const keys = allNotifications.map((n) => n.dismissKey);
    setDismissedLocal((prev) => new Set([...prev, ...keys]));
    const noticeIds = allNotifications
      .filter((n) => n.kind === 'alarm' && n.isAutomation)
      .map((n) => n.id);
    if (noticeIds.length) markNoticesRead.mutate(noticeIds);
    const persistKeys = allNotifications
      .filter((n) => !(n.kind === 'alarm' && n.isAutomation))
      .map((n) => n.dismissKey);
    if (persistKeys.length) void dismissNotifications(persistKeys);
  }

  // ACK inline no painel (apenas alarmes de telemetria).
  function handleAckInline(id: string) {
    acknowledgeAlarm.mutate(
      { alarmId: id, userId: user.id, note: '' },
      { onSuccess: () => handleDismiss(id) },
    );
  }

  async function handleLogout() {
    // Limpa o perfil mock de desenvolvimento antes de encerrar a sessão real
    localStorage.removeItem('bluebee_mock_role');
    await logout();
  }

  return (
    <>
      <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3 md:px-4">
        {/* ── Identidade do cliente (centralizada) ── */}
        {identityTenant && <TenantIdentity tenant={identityTenant} showLabel={isAdmin} />}
        {/* ── Left ── */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMenuClick}
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors md:hidden"
            aria-label={t('Abrir menu')}
          >
            <Menu size={20} strokeWidth={1.5} />
          </button>

          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarPinned ? t('Recolher sidebar') : t('Fixar sidebar aberta')}
            className="hidden md:flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
          >
            {sidebarPinned
              ? <PanelLeftClose size={19} strokeWidth={1.5} />
              : <PanelLeftOpen  size={19} strokeWidth={1.5} />}
          </button>

          {/* ── Tenant filter (admin only) ── */}
          {isAdmin && (
            <div className="relative ml-1" ref={tenantFilterRef}>
              <button
                type="button"
                onClick={() => {
                  setTenantFilterOpen((v) => !v);
                  setDropdownOpen(false);
                  setNotifOpen(false);
                }}
                className={`hidden sm:flex items-center gap-1.5 h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  selectedTenantId
                    ? 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:text-cyan-300'
                    : 'border-slate-200 bg-card text-slate-600 hover:bg-slate-50'
                }`}
                aria-label={t('Selecionar cliente')}
              >
                <Building2 size={13} strokeWidth={1.5} className={selectedTenantId ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400'} />
                <span className="max-w-[120px] truncate">
                  {selectedTenantName ?? t('Todos Clientes')}
                </span>
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`text-current transition-transform duration-200 ${tenantFilterOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Mobile: icon-only button */}
              <button
                type="button"
                onClick={() => {
                  setTenantFilterOpen((v) => !v);
                  setDropdownOpen(false);
                  setNotifOpen(false);
                }}
                className={`sm:hidden flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                  selectedTenantId
                    ? 'text-cyan-700 bg-cyan-50 hover:bg-cyan-100 dark:text-cyan-300'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
                aria-label={t('Selecionar cliente')}
              >
                <Building2 size={18} strokeWidth={1.5} />
              </button>

              {tenantFilterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTenantFilterOpen(false)} />
                  <TenantFilterDropdown
                    selectedTenantId={selectedTenantId}
                    tenants={tenants}
                    onSelect={setTenant}
                    onClose={() => setTenantFilterOpen(false)}
                  />
                </>
              )}
            </div>
          )}

          {/* ── Site filter (cliente sempre; admin após escolher um cliente) ── */}
          {showSiteFilter && (
            <div className="relative ml-1" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => {
                  setSiteFilterOpen((v) => !v);
                  setTenantFilterOpen(false);
                  setDropdownOpen(false);
                  setNotifOpen(false);
                }}
                className={`hidden sm:flex items-center gap-1.5 h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  selectedSiteId
                    ? 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:text-cyan-300'
                    : 'border-slate-200 bg-card text-slate-600 hover:bg-slate-50'
                }`}
                aria-label={t('Selecionar site')}
              >
                <MapPin size={13} strokeWidth={1.5} className={selectedSiteId ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400'} />
                <span className="max-w-[120px] truncate">
                  {selectedSiteName ?? t('Todos os Sites')}
                </span>
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`text-current transition-transform duration-200 ${siteFilterOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Mobile: icon-only button */}
              <button
                type="button"
                onClick={() => {
                  setSiteFilterOpen((v) => !v);
                  setTenantFilterOpen(false);
                  setDropdownOpen(false);
                  setNotifOpen(false);
                }}
                className={`sm:hidden flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                  selectedSiteId
                    ? 'text-cyan-700 bg-cyan-50 hover:bg-cyan-100 dark:text-cyan-300'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
                aria-label={t('Selecionar site')}
              >
                <MapPin size={18} strokeWidth={1.5} />
              </button>

              {siteFilterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSiteFilterOpen(false)} />
                  <SiteFilterDropdown
                    selectedSiteId={selectedSiteId}
                    sites={sites}
                    onSelect={setSite}
                    onClose={() => setSiteFilterOpen(false)}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right: bell + user ── */}
        <div className="flex items-center gap-1.5">
          {/* Notification bell */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setNotifOpen(true); setDropdownOpen(false); }}
              className="relative flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              aria-label={t('Notificações')}
            >
              <Bell size={18} strokeWidth={1.5} />
              {activeAlarmCount > 0 && (
                <span className={`absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 ring-2 ring-card text-[9px] font-bold text-white leading-none ${badgePulse ? 'animate-bell-badge-pulse' : ''}`}>
                  {activeAlarmCount > 9 ? '9+' : activeAlarmCount}
                </span>
              )}
            </button>
          </div>

          {/* User dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => { setDropdownOpen((v) => !v); setNotifOpen(false); }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-xs font-semibold text-white">
                {user.initials}
              </div>
              <span className="hidden sm:block text-sm font-medium text-foreground max-w-[120px] truncate">
                {user.name.split(' ')[0]}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2}
                className={`hidden sm:block text-muted-foreground transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />

                <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-sm font-semibold text-white">
                        {user.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground leading-none truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.email}</p>
                        {isTenant && user.tenantName && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{user.tenantName}</p>
                        )}
                      </div>
                    </div>
                    <span className="mt-2.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-600">
                      {t(roleLabels[user.role])}
                    </span>
                  </div>

                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => { setDropdownOpen(false); router.push('/account'); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <User size={15} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
                      {t('Editar perfil')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDropdownOpen(false); router.push('/preferences'); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Settings size={15} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
                      {t('Configurações da conta')}
                    </button>
                  </div>

               

                  <div className="border-t border-border py-1">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={15} strokeWidth={1.5} className="shrink-0" />
                      {t('Sair')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Painel lateral de notificações */}
      <NotificationDrawer
        open={notifOpen}
        notifications={allNotifications}
        isAdmin={isAdmin}
        unreadIds={unreadIds}
        onClose={() => setNotifOpen(false)}
        onDismiss={handleDismiss}
        onClearAll={handleClearAll}
        onNavigate={(href) => router.push(href)}
        onAck={handleAckInline}
        ackPendingId={acknowledgeAlarm.isPending ? (acknowledgeAlarm.variables?.alarmId ?? null) : null}
      />

      {/* Pop-up de novo alarme (produção) — host autocontido (também montado
          no viewer SCADA standalone, que não tem Topbar). */}
      <NewAlarmPopupHost
        onNoticesRead={(ids) => {
          setDismissedLocal((prev) => new Set([...prev, ...ids.map((id) => `notice:${id}`)]));
        }}
      />
    </>
  );
}
