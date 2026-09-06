import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'h-[25px] w-[22px]',
  sm: 'h-[30px] w-[26px]',
  md: 'h-[34px] w-[30px]',
  lg: 'h-[39px] w-[34px]',
} as const;

export type HexSize = keyof typeof SIZES;

interface HexProps {
  size?: HexSize;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}

export function Hex({ size = 'md', children, className, title }: HexProps) {
  return (
    <span
      title={title}
      className={cn('hex grid shrink-0 place-items-center leading-none', SIZES[size], className)}
    >
      {children}
    </span>
  );
}