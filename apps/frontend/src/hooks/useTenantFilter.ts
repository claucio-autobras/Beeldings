'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'bluebee_selected_tenant';
const CHANGE_EVENT = 'bluebee_tenant_change';

/**
 * Persiste e sincroniza o tenant selecionado globalmente.
 * null = "Todos os Sites".
 * Apenas roles admin (ADMIN, CCO, SUPERVISOR) devem usar este hook para alterar o valor.
 * Roles CLIENTE/VISUALIZADOR devem sempre usar o tenantId do próprio usuário.
 */

function getStoredTenant(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ?? null;
}

export function setGlobalTenant(tenantId: string | null): void {
  if (typeof window === 'undefined') return;
  if (tenantId === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, tenantId);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: tenantId }));
}

export function useTenantFilter() {
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTenantId(getStoredTenant());

    function handleChange(e: Event) {
      const detail = (e as CustomEvent<string | null>).detail;
      setSelectedTenantId(detail);
    }

    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, []);

  const setTenant = useCallback((tenantId: string | null) => {
    setGlobalTenant(tenantId);
  }, []);

  return { selectedTenantId, setTenant } as const;
}
