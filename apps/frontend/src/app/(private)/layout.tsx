'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/Topbar';
import { StorageAlertBanner } from '@/components/StorageAlertBanner';
import { BlueBeeAssistant } from '@/components/BlueBeeAssistant';
import { useAuthStore, selectIsAuthenticated } from '@/modules/auth/store/auth.store';

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const isLoading       = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  // Defesa em profundidade — redireciona caso o middleware não tenha barrado
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // O shell privado ocupa a viewport inteira. O scroll deve pertencer à área
  // principal (ou aos cards), nunca ao documento que contém sidebar e topbar.
  useEffect(() => {
    document.documentElement.classList.add('private-layout-lock');
    document.body.classList.add('private-layout-lock');
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.classList.remove('private-layout-lock');
      document.body.classList.remove('private-layout-lock');
    };
  }, []);

  // Spinner enquanto o store inicializa, evitando flash de conteúdo protegido
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex h-dvh min-h-0 w-full overflow-hidden">
      {/* ── Mobile overlay ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar / Drawer ── */}
      <div
        className={[
          'fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 md:relative md:translate-x-0 md:z-auto',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <Sidebar
          onClose={() => setDrawerOpen(false)}
          pinned={sidebarPinned}
        />
      </div>

      {/* ── Main area ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Topbar
          onMenuClick={() => setDrawerOpen(true)}
          sidebarPinned={sidebarPinned}
          onToggleSidebar={() => setSidebarPinned((v) => !v)}
        />
        <StorageAlertBanner />
        {pathname === '/dashboard' ? (
          <main className="surface-comb min-h-0 flex-1 overflow-hidden bg-background">
            <div className="h-full min-h-0 overflow-y-auto px-4 pb-4 pt-3 md:px-6 md:pb-6 md:pt-4">
              {children}
            </div>
          </main>
        ) : (
          <main className="surface-comb min-h-0 flex-1 overflow-y-auto bg-background p-4 md:p-6">
            {children}
          </main>
        )}
      </div>
      {pathname !== '/ai' && <BlueBeeAssistant />}
    </div>
  );
}
