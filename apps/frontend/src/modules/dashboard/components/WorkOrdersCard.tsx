'use client';

import { CheckCircle2, ClipboardList, Wrench } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { DashboardPanel, DashboardSectionTitle } from './DashboardShared';

type WorkOrderStatus = 'open' | 'in_progress' | 'closed';

interface DemoWorkOrder {
  id: string;
  title: string;
  status: WorkOrderStatus;
  context: string;
  updated: string;
}

interface WorkOrdersCardProps {
  /** Admin resume uma amostra cross-tenant; cliente recebe o contexto selecionado. */
  scope: 'admin' | 'client';
  tenantName?: string;
  siteName?: string;
}

const STATUS_CONFIG: Record<
  WorkOrderStatus,
  { label: string; tone: string; icon: typeof ClipboardList }
> = {
  open: {
    label: 'Abertas',
    tone: 'text-cyan-700 dark:text-cyan-300',
    icon: ClipboardList,
  },
  in_progress: {
    label: 'Em andamento',
    tone: 'text-amber-700 dark:text-amber-300',
    icon: Wrench,
  },
  closed: {
    label: 'Fechadas',
    tone: 'text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
};

const ADMIN_DEMO_ORDERS: DemoWorkOrder[] = [
  {
    id: 'OS-1042',
    title: 'Inspeção preventiva do quadro elétrico',
    status: 'open',
    context: 'Empresa Demo · Edifício Central',
    updated: 'Hoje, 09:20',
  },
  {
    id: 'OS-1038',
    title: 'Ajuste de sensor de temperatura',
    status: 'in_progress',
    context: 'Empresa Demo · Centro Logístico',
    updated: 'Hoje, 08:45',
  },
  {
    id: 'OS-1029',
    title: 'Revisão de comunicação do gateway',
    status: 'closed',
    context: 'Grupo Exemplo · Unidade Norte',
    updated: 'Ontem, 17:10',
  },
  {
    id: 'OS-1024',
    title: 'Teste de acionamento da bomba',
    status: 'closed',
    context: 'Grupo Exemplo · Unidade Sul',
    updated: '28/08, 14:30',
  },
];

function buildClientDemoOrders(tenantName: string, siteName: string): DemoWorkOrder[] {
  const context = `${tenantName} · ${siteName}`;
  return [
    {
      id: 'OS-1042',
      title: 'Inspeção preventiva do quadro elétrico',
      status: 'open',
      context,
      updated: 'Hoje, 09:20',
    },
    {
      id: 'OS-1038',
      title: 'Ajuste de sensor de temperatura',
      status: 'in_progress',
      context,
      updated: 'Hoje, 08:45',
    },
    {
      id: 'OS-1029',
      title: 'Revisão de comunicação do gateway',
      status: 'closed',
      context,
      updated: 'Ontem, 17:10',
    },
  ];
}

/**
 * Prévia visual do futuro módulo de OS. Os registros são deliberadamente
 * demonstrativos e recebem o contexto da tela para nunca parecerem dados reais
 * de outro cliente ou site.
 */
export function WorkOrdersCard({
  scope,
  tenantName,
  siteName,
}: WorkOrdersCardProps) {
  const t = useT();
  const resolvedTenant = tenantName || t('Cliente selecionado');
  const resolvedSite = siteName || t('Todos os locais');
  const orders =
    scope === 'admin'
      ? ADMIN_DEMO_ORDERS
      : buildClientDemoOrders(resolvedTenant, resolvedSite);
  const contextLabel =
    scope === 'admin'
      ? t('Todos os clientes e sites')
      : `${resolvedTenant} · ${resolvedSite}`;
  const counts = {
    open: orders.filter((order) => order.status === 'open').length,
    in_progress: orders.filter((order) => order.status === 'in_progress').length,
    closed: orders.filter((order) => order.status === 'closed').length,
  };

  return (
    <DashboardPanel className="p-5" accent>
      <div className="flex items-start justify-between gap-3">
        <DashboardSectionTitle
          eyebrow={contextLabel}
          title={t('Ordens de Serviço')}
          detail={t('Registros recentes')}
          action={<ClipboardList className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
        />
         <span className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-300">
          {t('Demonstrativo')}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2" aria-label={t('Resumo de ordens de serviço')}>
        {(Object.keys(STATUS_CONFIG) as WorkOrderStatus[]).map((status) => {
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          return (
            <div
              key={status}
              data-testid={`work-order-count-${status}`}
               className="rounded-xl border border-border bg-muted/20 p-3"
            >
                <p className={`flex items-center gap-1.5 text-[11px] font-medium ${config.tone}`}>
                <Icon size={12} strokeWidth={1.7} />
                {t(config.label)}
              </p>
              <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums tracking-[-.06em] text-foreground">
                {counts[status]}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex-1">
        <ul className="space-y-1.5">
          {orders.slice(0, 3).map((order) => {
            const config = STATUS_CONFIG[order.status];
            return (
              <li
                key={order.id}
                data-testid={`work-order-row-${order.id}`}
                 className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-2.5"
              >
                 <span className={`h-8 w-1 shrink-0 rounded-full ${
                  order.status === 'open'
                    ? 'bg-cyan-500'
                    : order.status === 'in_progress'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-foreground" title={order.title}>
                    {order.id} · {order.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground" title={order.context}>
                    {order.context}
                  </span>
                </span>
                <span className={`shrink-0 font-mono text-[10px] font-bold uppercase tracking-[.08em] ${config.tone}`}>
                  {t(config.label)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        {t('A integração com ordens de serviço ainda não está conectada.')}
      </p>
    </DashboardPanel>
  );
}