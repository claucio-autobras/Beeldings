'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Cctv, DoorOpen } from 'lucide-react';
import CftvPage from './cftv.page';

type TabKey = 'cftv' | 'sca';

function CftvScaContent() {
  const searchParams = useSearchParams();
  const initialTab: TabKey = searchParams.get('tab') === 'sca' ? 'sca' : 'cftv';
  const [tab, setTab] = useState<TabKey>(initialTab);

  const tabs: { key: TabKey; label: string; icon: typeof Cctv; comingSoon?: boolean }[] = [
    { key: 'cftv', label: 'CFTV', icon: Cctv },
    { key: 'sca', label: 'SCA', icon: DoorOpen, comingSoon: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dispositivos CFTV/SCA</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Câmeras (CFTV) e controle de acesso (SCA) em uma única área
        </p>
      </div>

      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map(({ key, label, icon: Icon, comingSoon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={[
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" strokeWidth={1.5} />
              {label}
              {comingSoon && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  em breve
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'cftv' ? (
        <CftvPage embedded />
      ) : (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <DoorOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-40" />
          <p className="text-sm font-medium text-foreground">SCA — Controle de Acesso</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Esta funcionalidade está em desenvolvimento e será disponibilizada em breve.
          </p>
        </div>
      )}
    </div>
  );
}

export default function CftvScaPage() {
  return (
    <Suspense fallback={null}>
      <CftvScaContent />
    </Suspense>
  );
}
