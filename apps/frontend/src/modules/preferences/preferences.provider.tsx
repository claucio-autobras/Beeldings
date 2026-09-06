'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/modules/auth/store/auth.store';
import { usePreferencesStore, applyTheme, PREFS_KEY } from './preferences.store';

/**
 * Hidrata as preferências do cache local (resposta instantânea), sincroniza
 * com o backend quando há sessão e reage a mudanças do tema do sistema
 * quando a preferência é "system".
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const hydrate = usePreferencesStore((s) => s.hydrate);
  const syncFromServer = usePreferencesStore((s) => s.syncFromServer);
  const theme = usePreferencesStore((s) => s.preferences.theme);

  // Cache local primeiro — o tema já foi aplicado pelo script no-flash;
  // aqui apenas alinhamos o estado React ao que está no storage.
  useEffect(() => {
    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Com sessão ativa, busca as preferências do backend (fonte da verdade).
  useEffect(() => {
    if (session) void syncFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Mudanças salvas em outra aba (via cache local) valem aqui na hora —
  // ex.: tema ou tempo de inatividade da sessão.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PREFS_KEY) hydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preferência "system": segue o SO em tempo real.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return <>{children}</>;
}
