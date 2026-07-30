import { cn } from '@/lib/utils';

interface BrandMarkProps {
  /** Tamanho do conjunto logo + wordmark. */
  size?: 'sm' | 'md' | 'lg';
  /** Oculta o texto "bluebee", exibindo apenas o ícone. */
  iconOnly?: boolean;
  className?: string;
}

const SIZES = {
  sm: { icon: 'h-7 w-7', text: 'text-lg' },
  md: { icon: 'h-9 w-9', text: 'text-2xl' },
  lg: { icon: 'h-11 w-11', text: 'text-3xl' },
} as const;

/**
 * Marca da BlueBee — ícone hexagonal + wordmark "bluebee".
 * Reutilizável em login, e-mails, telas públicas, etc.
 */
export function BrandMark({ size = 'md', iconOnly = false, className }: BrandMarkProps) {
  const s = SIZES[size];

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className={cn('shrink-0 text-cyan-700', s.icon)} aria-hidden>
        <svg viewBox="0 0 32 32" fill="none" className="h-full w-full">
          <path
            d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z"
            fill="currentColor"
            fillOpacity="0.12"
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
      </span>

      {!iconOnly && (
        <span className={cn('font-semibold tracking-tight', s.text)}>
          <span className="text-slate-900">Blue</span>
          <span className="text-cyan-700">bee</span>
        </span>
      )}
    </div>
  );
}
