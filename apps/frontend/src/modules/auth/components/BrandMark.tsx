import { cn } from '@/lib/utils';
import Image from 'next/image';

interface BrandMarkProps {
  /** Tamanho do conjunto logo + wordmark. */
  size?: 'sm' | 'md' | 'lg';
  /** Oculta o texto "bluebee", exibindo apenas o ícone. */
  iconOnly?: boolean;
  /** Variante para fundos escuros (wordmark branco + ícone ciano claro). */
  dark?: boolean;
  className?: string;
}

const SIZES = {
  sm: { width: 150, height: 30 },
  md: { width: 190, height: 37 },
  lg: { width: 250, height: 49 },
} as const;

/**
 * Marca Beeldings — ícone hexagonal + wordmark "Beeldings".
 * Reutilizável em login, e-mails, telas públicas, etc.
 */
export function BrandMark({ size = 'md', iconOnly = false, dark = false, className }: BrandMarkProps) {
  const s = SIZES[size];
  const src = dark ? '/beeldings-branco.png' : '/beeldings-azul.png';

  return (
    <div className={cn('flex items-center', className)}>
      <Image
        src={src}
        alt="Beeldings"
        width={s.width}
        height={s.height}
        priority={size === 'lg'}
        className={cn(
          'h-auto w-auto max-w-full object-contain',
          iconOnly && 'max-w-[3rem]',
        )}
      />
    </div>
  );
}
