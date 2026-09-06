import { Hex, type HexSize } from './Hex';
import { cn } from '@/lib/utils';

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

const META: Record<Severity, { inicial: string; rotulo: string; cls: string }> = {
  HIGH:   { inicial: 'A', rotulo: 'Alta', cls: 'bg-red-100 text-red-700 dark:bg-[#4a1f29] dark:text-[#fecaca]' },
  MEDIUM: { inicial: 'M', rotulo: 'Média', cls: 'bg-amber-100 text-amber-700 dark:bg-[#493417] dark:text-[#fde68a]' },
  LOW:    { inicial: 'B', rotulo: 'Baixa', cls: 'bg-blue-100 text-blue-700 dark:bg-[#1c3158] dark:text-[#bfdbfe]' },
};

interface SeverityHexProps {
  severity: Severity;
  size?: HexSize;
  className?: string;
}

export function SeverityHex({ severity, size = 'sm', className }: SeverityHexProps) {
  const meta = META[severity];
  return (
    <Hex size={size} title={meta.rotulo} className={cn('text-[11px] font-extrabold', meta.cls, className)}>
      <span aria-hidden>{meta.inicial}</span>
      <span className="sr-only">{meta.rotulo}</span>
    </Hex>
  );
}