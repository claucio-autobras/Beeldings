'use client';

import Link from 'next/link';
import { Monitor, BarChart2, LineChart, Bell } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Hex } from '@/components/ui/Hex';

// ─── Config ───────────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { href: '/alarms', icon: Bell, label: 'Alarmes', hint: 'Painel e histórico' },
  { href: '/scada', icon: Monitor, label: 'SCADA', hint: 'Telas e sinóticos' },
  { href: '/reports', icon: BarChart2, label: 'Relatórios', hint: 'Gerar PDF' },
  { href: '/trends', icon: LineChart, label: 'Trends', hint: 'Histórico' },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

/** "Acesso Rápido" (visão Cliente): atalhos em grade 2×2 para as telas principais. */
export function QuickAccess() {
  const t = useT();
  return (
    <div className="chamfer-sm border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 p-4 pb-3">
        <h2 className="text-sm font-medium text-foreground">{t('Acesso Rápido')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('Atalhos para as principais telas')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        {QUICK_LINKS.map(({ href, icon: Icon, label, hint }) => (
          <div
            key={href}
            className="chamfer chamfer-clickable group bg-border p-px"
          >
            <Link
              href={href}
              className="chamfer-in chamfer-hover-content block bg-muted/30 p-4 text-left"
            >
              <Hex size="md" className="bg-cyan-100/70 text-cyan-700 transition-colors group-hover:bg-cyan-100">
                <Icon size={18} strokeWidth={1.5} />
              </Hex>
              <div>
                <p className="text-sm font-medium text-foreground transition-colors group-hover:text-cyan-700">
                  {t(label)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t(hint)}</p>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
