'use client';

import type { ReactNode } from 'react';

interface DashboardSidebarStackProps {
  /** Card que aparece primeiro na coluna lateral. */
  recentAlarms?: ReactNode;
  /** Cards que aparecem no fluxo normal abaixo do alarme. */
  children?: ReactNode;
  profile: 'admin' | 'client';
}

/**
 * Coluna lateral do dashboard.
 *
 * Todos os cards permanecem no fluxo normal. A rolagem, quando necessária,
 * pertence ao corpo de cada card e não à pilha ou ao dashboard inteiro.
 */
export function DashboardSidebarStack({
  recentAlarms,
  children,
  profile,
}: DashboardSidebarStackProps) {
  return (
    <aside
      data-testid={`dashboard-sidebar-${profile}`}
      className="min-w-0 space-y-4"
    >
      {recentAlarms && (
        <div data-testid="dashboard-recent-alarms">{recentAlarms}</div>
      )}
      {children && <div className="space-y-4">{children}</div>}
    </aside>
  );
}