import { cn } from '@/lib/utils';

interface PanelProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  aux?: React.ReactNode;
  flush?: boolean;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({
  title, subtitle, aux, flush = false, children, className, bodyClassName,
}: PanelProps) {
  return (
    <div className={cn('chamfer flex min-w-0 bg-border p-px', className)}>
      <div className="chamfer-in flex min-w-0 flex-1 flex-col bg-card">
        {title !== undefined && (
          <div className="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border bg-background px-3.5">
            <span className="hex h-[13px] w-[11px] shrink-0 bg-cyan-600 dark:bg-cyan-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[12.5px] font-bold leading-tight tracking-tight text-foreground">
                {title}
              </h3>
              {subtitle && (
                <p className="truncate text-[10.5px] leading-tight text-muted-foreground">{subtitle}</p>
              )}
            </div>
            {aux && (
              <div className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-cyan-700 dark:text-cyan-400">
                {aux}
              </div>
            )}
          </div>
        )}
        <div className={cn('min-w-0 flex-1', flush ? '' : 'p-3.5', bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}