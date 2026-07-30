---
name: nextjs-patterns
description: Padrões obrigatórios para frontend Next.js do BlueBee IoT, incluindo App Router, estrutura de páginas privadas, componentes, services, hooks, mocks, estados, layout operacional e integração com APIs. Use quando Codex precisar criar, refatorar ou revisar páginas, componentes, fluxos, services e telas frontend do sistema IoT/BMS.
---

# Nextjs Patterns

## Estrutura de uma página

```typescript
// app/(private)/alarms/page.tsx
import { AlarmTable } from '@/components/alarms/AlarmTable';
import { PageHeader } from '@/components/layout/PageHeader';

export default function AlarmsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Alarmes" description="Monitoramento de alarmes em tempo real" />
      <AlarmTable />
    </div>
  );
}
```

## Estrutura de um componente

```typescript
// components/alarms/AlarmTable.tsx
import { useAlarms } from '@/hooks/useAlarms';
import { useTenant } from '@/hooks/useTenant';
import { AlarmBadge } from '@/components/alarms/AlarmBadge';
import type { Alarm } from '@bluebee/shared-types';

interface AlarmTableProps {
  limit?: number;
}

export function AlarmTable({ limit = 50 }: AlarmTableProps) {
  const { tenantId } = useTenant();
  const { data: alarms, isLoading, error } = useAlarms(tenantId);

  if (isLoading) return <AlarmTableSkeleton />;
  if (error) return <ErrorState message="Erro ao carregar alarmes" />;

  return (
    <div className="rounded-lg border">
      {/* conteúdo */}
    </div>
  );
}
```

## Hook com React Query

```typescript
// hooks/useAlarms.ts
import { useQuery } from '@tanstack/react-query';
import { alarmsService } from '@/services/alarms.service';
import type { Alarm } from '@bluebee/shared-types';

export function useAlarms(tenantId: string) {
  return useQuery<Alarm[]>({
    queryKey: ['alarms', tenantId],
    queryFn: () => alarmsService.getAll(tenantId),
    refetchInterval: 30_000,
    enabled: !!tenantId,
  });
}
```

## Service com suporte a mock

```typescript
// services/alarms.service.ts
import { apiClient } from '@/lib/api-client';
import { mockAlarmsService } from '@/mocks/handlers/alarms.handler';
import type { Alarm } from '@bluebee/shared-types';

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

export const alarmsService = {
  async getAll(tenantId: string): Promise<Alarm[]> {
    if (USE_MOCK) return mockAlarmsService.getAll(tenantId);
    return apiClient.get(`/alarms?tenantId=${tenantId}`);
  },

  async acknowledge(alarmId: string, note: string): Promise<void> {
    if (USE_MOCK) return mockAlarmsService.acknowledge(alarmId, note);
    return apiClient.patch(`/alarms/${alarmId}/acknowledge`, { note });
  },
};
```

## Estados de loading e erro (padrão)

```typescript
// Sempre tratar os três estados: loading, error, data
if (isLoading) return <ComponentSkeleton />;
if (error) return <ErrorState message="Mensagem amigável" />;
if (!data?.length) return <EmptyState message="Nenhum item encontrado" />;
return <ComponentContent data={data} />;
```

## Proteção de rotas por perfil (middleware)

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ROLE_ROUTES: Record<string, string[]> = {
  '/cco': ['ADMIN', 'CCO'],
  '/admin': ['ADMIN'],
};

export function middleware(request: NextRequest) {
  const role = request.cookies.get('user-role')?.value;
  const path = request.nextUrl.pathname;

  for (const [route, allowedRoles] of Object.entries(ROLE_ROUTES)) {
    if (path.startsWith(route) && !allowedRoles.includes(role ?? '')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
}
```

