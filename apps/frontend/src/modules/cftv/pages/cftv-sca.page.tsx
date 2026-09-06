'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Cctv, DoorOpen } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import CftvPage from './cftv.page';
import ScaPage from '@/modules/sca/pages/sca.page';

type TabKey = 'cftv' | 'sca';

function CftvScaContent() {
  const searchParams = useSearchParams();
  const initialTab: TabKey = searchParams.get('tab') === 'sca' ? 'sca' : 'cftv';
  const [tab, setTab] = useState<TabKey>(initialTab);

  // Deep-link do gráfico de quedas do dashboard (Admin): ?tenantId=&tenantName=
  // aplica o cliente como filtro global antes das telas CFTV/SCA carregarem,
  // sem o Admin precisar reselecionar manualmente (CftvPage/ScaPage já leem o
  // filtro global via useTenantFilter).
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId, setTenant } = useTenantFilter();
  const deepLinkTenantId = searchParams.get('tenantId');
  const deepLinkTenantName = searchParams.get('tenantName');
  const tenantDeepLinkConsumed = useRef(false);
  useEffect(() => {
    if (!isAdmin || tenantDeepLinkConsumed.current || !deepLinkTenantId) return;
    tenantDeepLinkConsumed.current = true;
    if (deepLinkTenantId !== selectedTenantId) {
      setTenant(deepLinkTenantId, deepLinkTenantName);
    }
  }, [isAdmin, deepLinkTenantId, deepLinkTenantName, selectedTenantId, setTenant]);

  const tabs: { key: TabKey; label: string; icon: typeof Cctv }[] = [
    { key: 'cftv', label: 'CFTV', icon: Cctv },
    { key: 'sca', label: 'SCA', icon: DoorOpen },
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
        {tabs.map(({ key, label, icon: Icon }) => {
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
            </button>
          );
        })}
      </div>

      {tab === 'cftv' ? (
        <CftvPage embedded />
      ) : (
        <ScaPage embedded />
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
