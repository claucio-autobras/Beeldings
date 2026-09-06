'use client';

// Layout para rotas publicas (login, recuperacao de senha, etc.)
// Sem sidebar, sem topbar. Renderiza sempre no tema light — ao sair
// destas rotas, o tema salvo do usuário é reaplicado.
import { useEffect } from 'react';
import { applyTheme, readCachedPreferences } from '@/modules/preferences/preferences.store';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    return () => {
      // Ao navegar para o app, o tema escolhido pelo usuário volta a valer.
      applyTheme(readCachedPreferences().theme);
    };
  }, []);

  return <>{children}</>;
}
