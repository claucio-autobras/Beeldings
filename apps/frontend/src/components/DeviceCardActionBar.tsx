'use client';

import type { LucideIcon } from 'lucide-react';

export interface CardAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  title?: string;
  iconClassName?: string;
}

export function DeviceCardActionBar({ actions }: { actions: CardAction[] }) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.title ?? action.label}
            className={[
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              action.tone === 'danger'
                ? 'text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            ].join(' ')}
          >
            <Icon className={`h-3.5 w-3.5 ${action.iconClassName ?? ''}`} />
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}