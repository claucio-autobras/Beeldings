import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, CircleDot, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DashboardPanel({
  children,
  className = '',
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <section
      className={cn(
        'dashboard-panel relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-[inset_0_1px_0_rgba(157,218,231,.045),0_22px_48px_rgba(0,0,0,.22)]',
        className
      )}
    >
      {accent && <span className="absolute inset-x-0 top-0 h-0.5 bg-cyan-600 dark:bg-cyan-400" />}
      {children}
    </section>
  );
}

export function DashboardSectionTitle({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700 dark:text-cyan-300">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 text-[15px] font-bold tracking-[-.025em] text-foreground">{title}</h2>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export type Status = 'normal' | 'atencao' | 'falha' | 'sem dados' | 'carregando' | 'alerta';

export function StatusChip({ status, children }: { status: Status; children?: ReactNode }) {
  const config = {
    normal: {
      icon: CheckCircle2,
      label: 'Normal',
      classes:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    atencao: {
      icon: AlertTriangle,
      label: 'Atenção',
      classes:
        'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300',
    },
    falha: {
      icon: AlertCircle,
      label: 'Falha',
      classes: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
    },
    'sem dados': {
      icon: CircleDot,
      label: 'Sem dados',
      classes: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    },
    carregando: {
      icon: RefreshCw,
      label: 'Carregando',
      classes:
        'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300',
    },
    alerta: {
      icon: AlertCircle,
      label: 'Alerta',
      classes:
        'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300',
    },
  }[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[.08em]',
        config.classes
      )}
    >
      <Icon className={cn('h-3 w-3', status === 'carregando' ? 'animate-spin' : '')} />
      {children ?? config.label}
    </span>
  );
}
