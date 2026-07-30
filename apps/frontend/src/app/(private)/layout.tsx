'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/Topbar';
import { StorageAlertBanner } from '@/components/StorageAlertBanner';
import { useAuthStore, selectIsAuthenticated } from '@/modules/auth/store/auth.store';

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const router = useRouter();
  const isLoading       = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  // Defesa em profundidade — redireciona caso o middleware não tenha barrado
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

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
    <div className="flex h-full">
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
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          onMenuClick={() => setDrawerOpen(true)}
          sidebarPinned={sidebarPinned}
          onToggleSidebar={() => setSidebarPinned((v) => !v)}
        />
        <StorageAlertBanner />
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
