'use client';

import { useState, useEffect, useCallback, useContext } from 'react';
import { TenantFilterInitialContext } from '@/components/TenantFilterProvider';

const STORAGE_KEY      = 'bluebee_selected_tenant';
const STORAGE_KEY_NAME = 'bluebee_selected_tenant_name';
const CHANGE_EVENT     = 'bluebee_tenant_change';

// Nomes dos cookies legíveis no servidor (bridge server→client).
const COOKIE_ID   = 'bluebee_tenant_id';
const COOKIE_NAME = 'bluebee_tenant_name';

/**
 * Persiste e sincroniza o tenant selecionado globalmente.
 * null = "Todos os Clientes".
 * Apenas roles admin (ADMIN, CCO, SUPERVISOR) devem usar este hook para alterar o valor.
 * Roles CLIENTE/VISUALIZADOR devem sempre usar o tenantId do próprio usuário.
 *
 * Estratégia anti-flash:
 * - O layout raiz (server component) lê os cookies `bluebee_tenant_id` /
 *   `bluebee_tenant_name` e os injeta via `TenantFilterProvider`.
 * - `useTenantFilter` inicializa o estado com esses valores do contexto, de
 *   modo que servidor e cliente renderizam o mesmo nome desde o primeiro paint
 *   — sem hydration mismatch e sem flash de "Todos Clientes".
 * - O `useEffect` de montagem sincroniza com o `localStorage` para casos em que
 *   o cookie esteja desatualizado (outra aba, cookie expirado, etc.).
 */

function setCookie(name: string, value: string | null): void {
  if (typeof document === 'undefined') return;
  if (value === null) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  } else {
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  }
}

export function setGlobalTenant(tenantId: string | null, tenantName?: string | null): void {
  if (typeof window === 'undefined') return;

  if (tenantId === null) {
    // Limpa id E nome juntos — atomicidade garantida.
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_NAME);
    setCookie(COOKIE_ID, null);
    setCookie(COOKIE_NAME, null);
  } else {
    localStorage.setItem(STORAGE_KEY, tenantId);
    // Atualizar o id sem nome limpa o nome para evitar stale mismatch.
    if (tenantName != null) {
      localStorage.setItem(STORAGE_KEY_NAME, tenantName);
      setCookie(COOKIE_NAME, tenantName);
    } else {
      localStorage.removeItem(STORAGE_KEY_NAME);
      setCookie(COOKIE_NAME, null);
    }
    setCookie(COOKIE_ID, tenantId);
  }

  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: tenantId }));
}

export function useTenantFilter() {
  // Valores iniciais vindos do servidor via cookie → TenantFilterProvider.
  // No primeiro render (servidor e hydration), selectedTenantId/Name refletem
  // o cookie — mesma saída em ambos os lados, sem hydration mismatch.
  const initial = useContext(TenantFilterInitialContext);

  const [selectedTenantId,   setSelectedTenantId]   = useState<string | null>(initial.tenantId);
  const [selectedTenantName, setSelectedTenantName] = useState<string | null>(initial.tenantName);

  useEffect(() => {
    // Ao montar, sincroniza com localStorage (fonte de verdade do cliente).
    // Garante consistência caso o cookie esteja desatualizado (outra aba, etc.)
    const storedId   = localStorage.getItem(STORAGE_KEY)      ?? null;
    const storedName = localStorage.getItem(STORAGE_KEY_NAME) ?? null;
    setSelectedTenantId(storedId);
    setSelectedTenantName(storedName);

    function handleChange(e: Event) {
      const id = (e as CustomEvent<string | null>).detail;
      setSelectedTenantId(id);
      setSelectedTenantName(id ? (localStorage.getItem(STORAGE_KEY_NAME) ?? null) : null);
    }

    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, []);

  const setTenant = useCallback((tenantId: string | null, tenantName?: string | null) => {
    setGlobalTenant(tenantId, tenantName);
  }, []);

  return { selectedTenantId, selectedTenantName, setTenant } as const;
}
