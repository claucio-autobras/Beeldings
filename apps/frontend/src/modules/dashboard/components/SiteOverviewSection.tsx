'use client';

import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Droplets,
  Timer,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { SiteOverviewData } from '../services/dashboard.service';

interface Props {
  data?: SiteOverviewData;
  isLoading: boolean;
  isError: boolean;
  isAdmin: boolean;
  periodLabel: string;
}

type VisualMetricTone = 'cyan' | 'amber' | 'blue';

interface VisualMetric {
  title: string;
  value: string;
  unit: string;
  subtitle: string;
  footer: string;
  tone: VisualMetricTone;
  icon: LucideIcon;
  bars: number[];
}

// Conteúdo temporário somente para reproduzir o mockup. A integração com os
// pontos reais será feita depois, sem alterar a composição visual deste card.
const VISUAL_METRICS: VisualMetric[] = [
  {
    title: 'Consumo de energia',
    value: '18,4',
    unit: 'MWh',
    subtitle: 'últimas 24 horas',
    footer: '-0,2% vs. período anterior',
    tone: 'cyan',
    icon: Zap,
    bars: [42, 52, 48, 65, 75, 61, 78, 66, 83, 92, 74, 64],
  },
  {
    title: 'Horas de funcionamento',
    value: '6.482',
    unit: 'h',
    subtitle: 'motores, bombas e fancoils',
    footer: '+128 h no período',
    tone: 'amber',
    icon: Timer,
    bars: [43, 51, 48, 62, 57, 70, 67, 76, 79, 88, 82, 94],
  },
  {
    title: 'Histórico de água',
    value: '1.248',
    unit: 'm³',
    subtitle: 'medidor principal · últimos 30 dias',
    footer: 'média diária 41,6 m³',
    tone: 'blue',
    icon: Droplets,
    bars: [68, 76, 62, 70, 58, 64, 55, 49, 53, 44, 47, 39],
  },
];

const METRIC_TONE_CLASSES: Record<
  VisualMetricTone,
  { icon: string; bar: string }
> = {
  cyan: {
    icon: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/10',
    bar: 'bg-cyan-600 dark:bg-cyan-500',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/10',
    bar: 'bg-amber-500 dark:bg-amber-400',
  },
  blue: {
    icon: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/10',
    bar: 'bg-blue-600 dark:bg-blue-400',
  },
};

function VisualMetricCard({ metric }: { metric: VisualMetric }) {
  const t = useT();
  const tone = METRIC_TONE_CLASSES[metric.tone];
  const Icon = metric.icon;

  return (
    <article className="flex min-h-[214px] min-w-0 flex-col rounded-[16px] border border-border bg-muted p-3.5 shadow-sm transition-transform duration-200 hover:-translate-y-px dark:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-8 w-8 place-items-center rounded-[10px] ${tone.icon}`}>
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
      </div>
      <p className="mt-4 text-[11px] font-medium text-muted-foreground">{t(metric.title)}</p>
      <p className="mt-1 font-mono text-[21px] font-bold leading-none tracking-[-.07em] text-foreground">
        {metric.value}{' '}
        <span className="text-[14px] tracking-[-.04em] text-muted-foreground">{metric.unit}</span>
      </p>
      <p className="mt-1 min-h-[28px] text-[10px] leading-4 text-muted-foreground">{metric.subtitle}</p>
      <div className="mt-auto flex h-9 items-end gap-1" aria-hidden="true">
        {metric.bars.map((height, index) => (
          <span
            key={`${metric.title}-${index}`}
            className={`flex-1 rounded-t-[5px] ${tone.bar}`}
            style={{ height: `${height}%`, opacity: 0.92 - index * 0.01 }}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[9px] text-muted-foreground">{metric.footer}</p>
    </article>
  );
}

export function SiteOverviewSection(_props: Props) {
  const t = useT();
  return (
    <section
      aria-label={t('Visão geral do seu site')}
      data-period={_props.periodLabel}
      className="relative overflow-hidden rounded-[18px] border border-border bg-card p-4 text-foreground shadow-sm sm:p-5 dark:shadow-[0_22px_50px_rgba(2,12,28,.2)]"
    >
      <span className="absolute inset-x-0 top-0 h-[2px] bg-primary dark:bg-cyan-400" aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-4 px-1">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-cyan-700 dark:text-cyan-300">
            {t('Contexto da operação')}
          </p>
          <h2 className="mt-2 text-[15px] font-bold tracking-[-.035em] text-foreground">
            {t('Visão geral do seu site')}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Shopping Vale Sul · {t('leituras essenciais da operação')}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[.08em] text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} />
          {t('Site estável')}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {VISUAL_METRICS.map((metric) => (
          <VisualMetricCard key={metric.title} metric={metric} />
        ))}
      </div>

      <div className="mt-4 rounded-[16px] border border-cyan-200 bg-cyan-50/70 p-4 sm:p-5 dark:border-cyan-700/70 dark:bg-cyan-900/40">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-foreground">
              <Building2 className="h-4 w-4 text-cyan-700 dark:text-cyan-300" strokeWidth={1.8} />
              <p className="text-[15px] font-bold tracking-[-.04em]">{t('Resumo operacional')}</p>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Shopping Vale Sul · São José dos Campos · 6 áreas monitoradas
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[26px] font-bold leading-none tracking-[-.08em] text-emerald-700 dark:text-emerald-300">99,2%</p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">disponibilidade</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ['412', 'ativos'],
            ['405', 'online'],
            ['4', 'offline'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-[11px] border border-border bg-muted px-3 py-3.5">
              <p className="font-mono text-[18px] font-bold leading-none tracking-[-.06em] text-foreground">{value}</p>
              <p className="mt-2 text-[10px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
