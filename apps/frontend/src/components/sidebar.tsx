'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Building2,
  Cctv,
  ClipboardList,
  Cpu,
  Download,
  FileBarChart,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Router,
  Server,
  Settings,
  Terminal,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { useCurrentUser, type UserRole } from '@/hooks/useCurrentUser';
import { useT } from '@/lib/i18n';
import { useGatewayUpdateBadge } from '@/hooks/useGatewayUpdateBadge';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import { resolveScadaNavLabel } from './sidebar-navigation';

// ─── Tipos de navegação ──────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Item ainda não disponível — renderizado desabilitado com selo "em breve". */
  comingSoon?: boolean;
  /**
   * Quando fornecido e > 0, exibe um badge âmbar discreto com esse valor.
   * Usado para indicar gateways com atualização disponível.
   */
  badge?: number;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

// ─── Configuração de navegação por perfil ───────────────────────────────────

const NAV_ADMIN: NavGroup[] = [
  {
    group: 'Principal',
    items: [
      { label: 'Dashboard',    href: '/dashboard', icon: LayoutDashboard },
      { label: 'Alarmes',      href: '/alarms',    icon: Bell },
      { label: 'Dispositivos / IOT / BMS', href: '/devices', icon: Cpu },
      { label: 'Dispositivos CFTV/SCA', href: '/cftv-sca', icon: Cctv },
      { label: 'Trends',       href: '/trends',    icon: TrendingUp },
      { label: 'Sites',        href: '/scada',     icon: Monitor },
    ],
  },
  {
    group: 'Monitoramento',
    items: [
      { label: 'Relatórios', href: '/reports',    icon: FileBarChart },
      { label: 'Automações', href: '/automation', icon: Zap },
      { label: 'Chamados (Infraspeak)', href: '/infraspeak', icon: ClipboardList },
      { label: 'Bluebee',    href: '/ai',         icon: MessageSquare },
    ],
  },
  {
    group: 'Administração',
    items: [
      { label: 'Clientes',     href: '/admin/clients',  icon: Building2 },
      { label: 'Usuários',  href: '/admin/users',    icon: Users },
      { label: 'Gateways',  href: '/admin/gateways', icon: Router },
      { label: 'Agente de Gateway', href: '/admin/gateway-agent', icon: Download },
      { label: 'Servidores', href: '/admin/cluster', icon: Server },
      { label: 'Conhecimento', href: '/admin/knowledge', icon: BookOpen },
      { label: 'Ajustes',   href: '/admin/settings', icon: Settings },
    ],
  },
];

const NAV_CCO: NavGroup[] = [
  {
    group: 'Principal',
    items: [
      { label: 'Dashboard',    href: '/dashboard', icon: LayoutDashboard },
      { label: 'Alarmes',      href: '/alarms',    icon: Bell },
      { label: 'Dispositivos / IOT / BMS', href: '/devices', icon: Cpu },
      { label: 'Dispositivos CFTV/SCA', href: '/cftv-sca', icon: Cctv },
      { label: 'Trends',       href: '/trends',    icon: TrendingUp },
      { label: 'Sites',        href: '/scada',     icon: Monitor },
    ],
  },
  {
    group: 'Monitoramento',
    items: [
      { label: 'Relatórios', href: '/reports',    icon: FileBarChart },
      { label: 'Automações', href: '/automation', icon: Zap },
      { label: 'Chamados (Infraspeak)', href: '/infraspeak', icon: ClipboardList },
      { label: 'Bluebee',    href: '/ai',         icon: MessageSquare },
    ],
  },
  {
    group: 'CCO',
    items: [
      { label: 'Comandos', href: '/cco/commands', icon: Terminal },
    ],
  },
  {
    group: 'Administração',
    items: [
      { label: 'Sites',     href: '/admin/clients',  icon: Building2 },
      { label: 'Usuários',  href: '/admin/users',    icon: Users },
      { label: 'Gateways',  href: '/admin/gateways', icon: Router },
      { label: 'Agente de Gateway', href: '/admin/gateway-agent', icon: Download },
      { label: 'Servidores', href: '/admin/cluster', icon: Server },
      { label: 'Conhecimento', href: '/admin/knowledge', icon: BookOpen },
      { label: 'Ajustes',   href: '/admin/settings', icon: Settings },
    ],
  },
];

const NAV_SUPERVISOR: NavGroup[] = NAV_ADMIN;

const NAV_CLIENTE: NavGroup[] = [
  {
    group: 'Principal',
    items: [
      { label: 'Telas',     href: '/scada',     icon: Monitor },
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Alarmes',   href: '/alarms',    icon: Bell },
      { label: 'Dispositivos / IOT / BMS', href: '/devices', icon: Cpu },
      { label: 'Dispositivos CFTV/SCA', href: '/cftv-sca', icon: Cctv },
      { label: 'Trends',    href: '/trends',    icon: TrendingUp },
    ],
  },
  {
    group: 'Monitoramento',
    items: [
      { label: 'Relatórios', href: '/reports', icon: FileBarChart },
      { label: 'Bluebee',    href: '/ai',      icon: MessageSquare },
    ],
  },
  {
    group: 'Administração',
    items: [
      { label: 'Usuários', href: '/admin/users', icon: Users },
    ],
  },
];

/*const NAV_VISUALIZADOR: NavGroup[] = [
  {
    group: 'Principal',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Alarmes',   href: '/alarms',    icon: Bell },
      { label: 'Trends',    href: '/trends',    icon: TrendingUp },
    ],
  },
  {
    group: 'Monitoramento',
    items: [
      { label: 'Relatórios', href: '/reports', icon: FileBarChart },
      { label: 'Chat IA',    href: '/ai',      icon: MessageSquare },
    ],
  },
];*/

function getNavForRole(role: UserRole): NavGroup[] {
  switch (role) {
    case 'ADMIN':        return NAV_ADMIN;
    case 'CCO':          return NAV_CCO;
    case 'SUPERVISOR':   return NAV_SUPERVISOR;
    case 'CLIENTE':      return NAV_CLIENTE;
    case 'VISUALIZADOR': return NAV_CLIENTE;
    //case 'VISUALIZADOR': return NAV_VISUALIZADOR;
    default: return NAV_ADMIN;
  }
}

// ─── Sidebar Component ────────────────────────────────────────────────────────

interface SidebarProps {
  onClose?: () => void;
  /** Controlado pelo layout — true = sempre expandido */
  pinned: boolean;
}

export function Sidebar({ onClose, pinned }: SidebarProps) {
  const pathname   = usePathname();
  const user       = useCurrentUser();
  const t          = useT();
  const isSiteOperator = user.role === 'CLIENTE' || user.role === 'VISUALIZADOR';

  // Both endpoints are tenant-scoped by the backend for operator profiles.
  // Keep them disabled for global profiles to avoid unnecessary requests and
  // to prevent a global response from becoming a client-side nav label.
  const { data: sites, isLoading: sitesLoading } = useSites(user.tenantId, {
    enabled: isSiteOperator && Boolean(user.tenantId),
  });
  const { data: tenants, isLoading: tenantsLoading } = useTenants({
    enabled: isSiteOperator && Boolean(user.tenantId),
    scope: user.tenantId,
  });
  const scopedTenantName =
    user.tenantName ??
    tenants?.find((tenant) => tenant.id === user.tenantId)?.name ??
    null;
  const scadaLabel = resolveScadaNavLabel(
    user.role,
    sitesLoading || tenantsLoading ? undefined : sites,
    scopedTenantName,
  );

  // Only admins, CCOs and supervisors see the Gateways item — gate polling to avoid
  // spurious 403s for CLIENTE users (who have no tenant scope on that endpoint).
  const canSeeGateways = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const gatewayBadge   = useGatewayUpdateBadge(canSeeGateways);

  const baseNavigation = getNavForRole(user.role);
  const navigationWithScadaLabel = isSiteOperator
    ? baseNavigation.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.href === '/scada' ? { ...item, label: scadaLabel } : item,
        ),
      }))
    : baseNavigation;

  // Inject the live badge value into the Gateways nav item without mutating shared config.
  const navigation: NavGroup[] = canSeeGateways && gatewayBadge > 0
    ? navigationWithScadaLabel.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.href === '/admin/gateways'
            ? { ...item, badge: gatewayBadge }
            : item,
        ),
      }))
    : navigationWithScadaLabel;

  // O estado de foco é local: expande temporariamente enquanto o cursor estiver sobre a barra lateral recolhida.
  const [hovered, setHovered] = useState(false);

  // Em dispositivos móveis (< md = 768px), a barra lateral está sempre totalmente expandida dentro do menu lateral.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Em dispositivos móveis, a barra lateral está sempre expandida; no desktop, a barra lateral segue o estado de pin + hover.
  const isExpanded = isMobile || pinned || hovered;

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <aside
      className={[
        'app-sidebar flex h-full shrink-0 flex-col bg-slate-900 overflow-x-hidden',
        'md:transition-[width] md:duration-300 md:ease-in-out',
        isExpanded ? 'w-64' : 'md:w-16',
      ].join(' ')}
      onMouseEnter={() => { if (!isMobile && !pinned) setHovered(true); }}
      onMouseLeave={() => { if (!isMobile) setHovered(false); }}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div
        className={[
          'flex h-14 shrink-0 items-center border-b border-slate-700/60',
          'transition-all duration-300',
          isExpanded ? 'justify-start px-4 gap-2.5' : 'justify-center px-0',
        ].join(' ')}
      >
        <Image
          src="/beeldings-branco.png"
          alt="Beeldings"
          width={220}
          height={43}
          priority
          className={[
            'h-auto max-w-full object-contain transition-all duration-300',
            isExpanded ? 'w-[11rem]' : 'w-12',
          ].join(' ')}
        />
      </div>

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4">
        <div className={`transition-all duration-300 ${isExpanded ? 'px-3' : 'px-2'}`}>
          {navigation.map(({ group, items }, groupIndex) => (
            <div key={group} className="mb-4">
              {/* Rótulo do grupo — recolhe em altura & desvanece quando a barra lateral é recolhida */}
              <p
                className={[
                  'px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500',
                  'whitespace-nowrap overflow-hidden transition-all duration-200',
                  isExpanded ? 'mb-1.5 max-h-5 opacity-100' : 'mb-0 max-h-0 opacity-0',
                ].join(' ')}
              >
                {t(group)}
              </p>

              {/* Separador fino que substitui o rótulo do grupo quando a barra lateral é recolhida (pule o primeiro grupo) */}
              {!isExpanded && groupIndex > 0 && (
                <div className="mx-1 mb-2 h-px bg-slate-700/50" />
              )}

              <ul className="space-y-0.5">
                {items.map(({ label, href, icon: Icon, comingSoon, badge }) => {
                  const active = isActive(href);
                  // Build tooltip: badge info is appended when collapsed.
                  const tooltipLabel = !isExpanded
                    ? badge
                      ? `${t(label)} — ${badge} gateway(s) ${t('com atualização disponível')}`
                      : t(label)
                    : undefined;

                  if (comingSoon) {
                    return (
                      <li key={href}>
                        <span
                          title={!isExpanded ? `${t(label)} (${t('em breve')})` : undefined}
                          className={[
                            'flex items-center py-1 text-sm font-medium cursor-default select-none',
                            'text-slate-500',
                            isExpanded ? 'gap-2.5 px-2' : 'justify-center px-0',
                          ].join(' ')}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-slate-600" strokeWidth={1.5} />
                          <span
                            className={[
                              'flex items-center gap-1.5 whitespace-nowrap overflow-hidden transition-all duration-200',
                              isExpanded ? 'max-w-full opacity-100' : 'max-w-0 w-0 opacity-0',
                            ].join(' ')}
                          >
                            {t(label)}
                            <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                              {t('em breve')}
                            </span>
                          </span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => onClose?.()}
                        title={tooltipLabel}
                        className={[
                           'relative flex items-center py-1 text-sm font-medium',
                          'transition-all duration-200',
                          isExpanded ? 'gap-2.5 px-2' : 'justify-center px-0',
                             active
                             ? 'text-white font-semibold'
                             : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                        ].join(' ')}
                      >
                         {active && isExpanded && (
                           <span aria-hidden className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 bg-cyan-400" />
                         )}
                        <span className="relative shrink-0">
                           <span className={[
                             'hex grid h-[30px] w-[26px] place-items-center transition-colors',
                             active ? 'bg-cyan-400' : 'bg-slate-800',
                           ].join(' ')}>
                             <Icon
                               className={`h-[15px] w-[15px] ${active ? 'text-slate-900' : 'text-slate-400'}`}
                               strokeWidth={1.7}
                             />
                           </span>
                          {!!badge && (
                            <span
                              aria-label={`${badge} ${t('com atualização disponível')}`}
                              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-slate-900"
                            />
                          )}
                        </span>
                        {/* Rótulo — desvanece & recolhe quando a barra lateral é recolhida */}
                        <span
                          className={[
                            'flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap overflow-hidden transition-all duration-200',
                            isExpanded ? 'max-w-full opacity-100' : 'max-w-0 w-0 opacity-0',
                          ].join(' ')}
                        >
                          <span className="truncate">{t(label)}</span>
                          {!!badge && (
                            <span
                              title={`${badge} gateway(s) ${t('com atualização disponível')}`}
                              className="ml-auto shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-900"
                            >
                              {badge}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}
