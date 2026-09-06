'use client';

/**
 * Ponte servidor→cliente para o tenant filtrado globalmente.
 *
 * O layout raiz (server component) lê os cookies `bluebee_tenant_id` e
 * `bluebee_tenant_name`, passando-os como props para este componente.
 * O contexto resultante é consumido em `useTenantFilter`, que usa os valores
 * do servidor como estado inicial — garantindo que o primeiro render do cliente
 * já contenha o nome do tenant correto (sem flash de "Todos Clientes" ou UUID).
 */

import { createContext, useContext } from 'react';

export interface TenantFilterInitial {
  tenantId: string | null;
  tenantName: string | null;
}

export const TenantFilterInitialContext = createContext<TenantFilterInitial>({
  tenantId: null,
  tenantName: null,
});

export function TenantFilterProvider({
  children,
  initialTenantId,
  initialTenantName,
}: {
  children: React.ReactNode;
  initialTenantId: string | null;
  initialTenantName: string | null;
}) {
  return (
    <TenantFilterInitialContext.Provider value={{ tenantId: initialTenantId, tenantName: initialTenantName }}>
      {children}
    </TenantFilterInitialContext.Provider>
  );
}

export function useTenantFilterInitial(): TenantFilterInitial {
  return useContext(TenantFilterInitialContext);
}
