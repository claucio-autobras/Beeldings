'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

const CENTER = { left: '50%', top: '50%' };
const SATELLITES = [
  { left: '31.86%', top: '16.95%' },
  { left: '68.14%', top: '16.95%' },
  { left: '86.27%', top: '50%' },
  { left: '68.14%', top: '83.05%' },
  { left: '31.86%', top: '83.05%' },
  { left: '13.73%', top: '50%' },
] as const;
const HIVE_HEX_CLIP = 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)';

export type HiveTone = 'critical' | 'warning' | 'brand' | 'offline';
export type HiveMetric = 'alarms' | 'ack' | 'offline' | 'clients' | 'gateways' | 'critical' | 'iot' | 'sites';

const TONS: Record<HiveTone, {
  borda: string;
  face: string;
  texto: string;
  rotulo: string;
  subtexto: string;
}> = {
  critical: {
    borda: 'bg-[#C97882] dark:bg-[#C75B65]',
    face: 'bg-[#F7DDE0] dark:bg-[#762B35]',
    texto: 'text-[#7F202B] dark:text-[#FFF1F2]',
    rotulo: 'text-[#8C303A]/85 dark:text-[#FFE4E6]/90',
    subtexto: 'text-[#8C303A]/75 dark:text-[#FECDD3]/85',
  },
  warning: {
    borda: 'bg-[#D4976D] dark:bg-[#C27A4B]',
    face: 'bg-[#FBE8D8] dark:bg-[#75431F]',
    texto: 'text-[#813C1B] dark:text-[#FFF7ED]',
    rotulo: 'text-[#935024]/85 dark:text-[#FFEDD5]/90',
    subtexto: 'text-[#935024]/75 dark:text-[#FED7AA]/85',
  },
  brand: {
    borda: 'bg-[#67B4C1] dark:bg-[#3D93A1]',
    face: 'bg-[#DDF3F6] dark:bg-[#145B67]',
    texto: 'text-[#0B6170] dark:text-[#ECFEFF]',
    rotulo: 'text-[#1F7582]/85 dark:text-[#CFFAFE]/90',
    subtexto: 'text-[#1F7582]/75 dark:text-[#A5F3FC]/85',
  },
  offline: {
    borda: 'bg-[#91A3B3] dark:bg-[#64748B]',
    face: 'bg-[#E6EDF1] dark:bg-[#1D293D]',
    texto: 'text-[#3F4F5F] dark:text-[#F8FAFC]',
    rotulo: 'text-[#526271]/85 dark:text-[#E2E8F0]/90',
    subtexto: 'text-[#526271]/75 dark:text-[#CBD5E1]/85',
  },
};

export interface HiveSatellite {
  id: HiveMetric;
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ReactNode;
  tone: HiveTone;
  href?: string;
}

interface HiveProps {
  center: {
    id: HiveMetric;
    label: string;
    value: React.ReactNode;
    sub?: string;
    href?: string;
    tone?: HiveTone;
  };
  satellites: HiveSatellite[];
  className?: string;
  loading?: boolean;
}

function Celula({
  style, tone, children, href, label, contentClassName
}: {
  style: React.CSSProperties;
  tone: HiveTone;
  children: React.ReactNode;
  href?: string;
  label: string;
  contentClassName?: string;
}) {
  const t = TONS[tone];
  const baseClass = cn(
    "absolute -translate-x-1/2 -translate-y-1/2 transition-[transform,filter] duration-200 hover:scale-[1.035] hover:drop-shadow-[0_9px_8px_rgba(15,23,42,0.28)] focus-visible:drop-shadow-[0_9px_8px_rgba(15,23,42,0.28)]"
  );

  const corpo = (
    <>
      <span className={cn('hive-hex absolute inset-0', t.borda)} style={{ clipPath: HIVE_HEX_CLIP }} />
      <span
        className={cn(
          'hive-hex absolute inset-[1.5px] flex flex-col items-center justify-center gap-0.5 text-center',
          contentClassName ?? 'px-[12%]',
          t.face
        )}
        style={{ clipPath: HIVE_HEX_CLIP }}
      >
        {children}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={label} style={style} className={baseClass}>
        {corpo}
      </Link>
    );
  }
  return (
    <div style={style} className={baseClass} aria-label={label}>
      {corpo}
    </div>
  );
}

export function Hive({ center, satellites, className, loading = false }: HiveProps) {
  const centerTone = center.tone ?? 'brand';
  const c = TONS[centerTone];

  return (
    <div
      className={cn(
        'relative mx-auto aspect-[408/388] w-full max-w-[530px] min-w-0 shrink-0',
        className,
      )}
      role="group"
      aria-label="Indicadores da operação"
    >
      <div className="absolute inset-0">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[88%] w-[84%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(14,116,144,.10),rgba(14,116,144,.025)_55%,transparent_72%)] dark:bg-[radial-gradient(circle,rgba(34,211,238,.09),rgba(34,211,238,.025)_55%,transparent_72%)]"
        />
        <Celula
          style={{ ...CENTER, width: '41.18%', height: '50%' }}
          tone={centerTone}
          href={center.href}
          label={`${center.label}: ${String(center.value)}`}
        >
          {loading ? (
             <span className="my-1 h-9 w-20 animate-pulse rounded bg-cyan-500/20" aria-label="Carregando" />
          ) : (
            <>
              <span className={cn('font-mono text-[11px] font-bold uppercase leading-tight tracking-[.06em]', c.rotulo)}>{center.label}</span>
              <span className={cn('text-[clamp(31px,7vw,43px)] font-mono font-bold leading-none tracking-[-.08em]', c.texto)}>{center.value}</span>
              {center.sub && <span className={cn('font-mono text-[10px] leading-tight', c.subtexto)}>{center.sub}</span>}
            </>
          )}
        </Celula>

        {satellites.slice(0, 6).map((s, i) => {
          const t = TONS[s.tone];
          return (
            <Celula
              key={s.id}
              style={{ ...SATELLITES[i], width: '27.45%', height: '33.25%' }}
              tone={s.tone}
              href={s.href}
              label={`${s.label}: ${String(s.value)}`}
              contentClassName={s.id === 'ack' ? 'px-[4%]' : undefined}
            >
              {loading ? (
                <span className="my-1 h-5 w-9 animate-pulse rounded bg-current/15" aria-label="Carregando" />
              ) : (
                <>
                  <span className={t.texto} aria-hidden>{s.icon}</span>
                  <span
                    className={cn(
                      'font-mono font-semibold uppercase leading-tight',
                      s.id === 'ack'
                        ? 'whitespace-nowrap text-[9px] tracking-[.02em]'
                        : 'text-[10px] tracking-[.08em]',
                      t.rotulo,
                    )}
                  >
                    {s.label}
                  </span>
                  <span className={cn('text-[clamp(17px,4vw,23px)] font-mono font-bold leading-none tracking-[-.08em]', t.texto)}>{s.value}</span>
                  {s.sub && <span className={cn('font-mono text-[10px] leading-tight', t.subtexto)}>{s.sub}</span>}
                </>
              )}
            </Celula>
          );
        })}
      </div>
    </div>
  );
}