'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'bluebee_selected_site';
const CHANGE_EVENT = 'bluebee_site_change';

/**
 * Persiste e sincroniza o site selecionado globalmente.
 * null = "Todos os Sites".
 *
 * Cliente (CLIENTE/VISUALIZADOR): escolhe entre os sites do próprio tenant.
 * Admin (ADMIN/CCO/SUPERVISOR): só faz sentido após escolher um cliente — ao
 * trocar de cliente o seletor de site é zerado (ver Topbar).
 *
 * Espelha o padrão de useTenantFilter.
 */

function getStoredSite(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ?? null;
}

export function setGlobalSite(siteId: string | null): void {
  if (typeof window === 'undefined') return;
  if (siteId === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, siteId);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: siteId }));
}

export function useSiteFilter() {
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSiteId(getStoredSite());

    function handleChange(e: Event) {
      const detail = (e as CustomEvent<string | null>).detail;
      setSelectedSiteId(detail);
    }

    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, []);

  const setSite = useCallback((siteId: string | null) => {
    setGlobalSite(siteId);
  }, []);

  return { selectedSiteId, setSite } as const;
}
