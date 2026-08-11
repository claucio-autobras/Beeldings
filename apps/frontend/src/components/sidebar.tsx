'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
      { label: 'Telas',        href: '/scada',     icon: Monitor },
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
      { label: 'Telas',        href: '/scada',     icon: Monitor },
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
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Alarmes',   href: '/alarms',    icon: Bell },
      { label: 'Dispositivos / IOT / BMS', href: '/devices', icon: Cpu },
      { label: 'Dispositivos CFTV/SCA', href: '/cftv-sca', icon: Cctv },
      { label: 'Trends',    href: '/trends',    icon: TrendingUp },
      { label: 'Telas',        href: '/scada',     icon: Monitor },
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

  // Only admins, CCOs and supervisors see the Gateways item — gate polling to avoid
  // spurious 403s for CLIENTE users (who have no tenant scope on that endpoint).
  const canSeeGateways = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const gatewayBadge   = useGatewayUpdateBadge(canSeeGateways);

  const baseNavigation = getNavForRole(user.role);

  // Inject the live badge value into the Gateways nav item without mutating shared config.
  const navigation: NavGroup[] = canSeeGateways && gatewayBadge > 0
    ? baseNavigation.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.href === '/admin/gateways'
            ? { ...item, badge: gatewayBadge }
            : item,
        ),
      }))
    : baseNavigation;

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
        {/* Ícone hexagonal — sempre visível */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center text-cyan-400">
          <svg viewBox="0 0 32 32" fill="none" className="h-8 w-8" aria-hidden>
            <path
              d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z"
              fill="currentColor"
              fillOpacity="0.18"
            />
            <path
              d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
            <path
              d="M16 10.5 21 13.5v5L16 21.5 11 18.5v-5L16 10.5Z"
              fill="currentColor"
            />
          </svg>
        </div>

        {/* Texto — desvanece & recolhe quando a barra lateral é estreita */}
        <div
          className={[
            'flex flex-col leading-none overflow-hidden transition-all duration-300',
            isExpanded ? 'opacity-100 max-w-[10rem]' : 'opacity-0 max-w-0',
          ].join(' ')}
        >
          <span className="whitespace-nowrap text-lg font-semibold text-white">
            <span className="text-white">Beel</span><span className="text-cyan-400">dings</span>
          </span>
          <span className="whitespace-nowrap text-xs text-slate-400">Autobras</span>
        </div>
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
                            'flex items-center rounded-md py-2 text-sm font-medium cursor-default select-none',
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
                          'relative flex items-center rounded-md py-2 text-sm font-medium',
                          'transition-all duration-200',
                          isExpanded ? 'gap-2.5 px-2' : 'justify-center px-0',
                          active
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                        ].join(' ')}
                      >
                        {/* Icon wrapper with update-available dot badge */}
                        <span className="relative shrink-0">
                          <Icon
                            className={`h-4 w-4 ${active ? 'text-white' : 'text-slate-400'}`}
                            strokeWidth={1.5}
                          />
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
