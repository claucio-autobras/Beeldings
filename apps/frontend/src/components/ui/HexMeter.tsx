import { cn } from '@/lib/utils';

interface HexMeterProps {
  value: number;
  cells?: number;
  fillClassName?: string;
  className?: string;
  label?: string;
}

export function HexMeter({
  value, cells = 10, fillClassName = 'bg-cyan-600 dark:bg-cyan-400', className, label,
}: HexMeterProps) {
  const pct = Math.min(100, Math.max(0, value));
  const cheias = Math.round((pct / 100) * cells);
  return (
    <div
      className={cn('flex items-center gap-[3px]', className)}
      role={label ? 'img' : undefined}
      aria-label={label ? `${label}: ${pct}%` : undefined}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className={cn('hex block h-[13px] w-[11px] shrink-0', i < cheias ? fillClassName : 'bg-border')}
        />
      ))}
    </div>
  );
}

export interface HexStripPart {
  value: number;
  className: string;
  label: string;
}

interface HexStripProps {
  parts: HexStripPart[];
  cells?: number;
  className?: string;
}

export function HexStrip({ parts, cells = 12, className }: HexStripProps) {
  const total = parts.reduce((acc, p) => acc + p.value, 0) || 1;
  const fatias = parts.reduce<{ usadas: number; itens: Array<HexStripPart & { q: number }> }>(
    (estado, p, i) => {
      const q = i === parts.length - 1 ? cells - estado.usadas : Math.round((p.value / total) * cells);
      return { usadas: estado.usadas + q, itens: [...estado.itens, { ...p, q: Math.max(0, q) }] };
    },
    { usadas: 0, itens: [] },
  ).itens;
  return (
    <div
      className={cn('flex items-center gap-[3px]', className)}
      role="img"
      aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}
    >
      {fatias.flatMap((f, i) =>
        Array.from({ length: f.q }, (_, k) => (
          <span key={`${i}-${k}`} className={cn('hex block h-[13px] w-[11px] shrink-0', f.className)} />
        )),
      )}
    </div>
  );
}