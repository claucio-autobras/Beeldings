'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, Loader2, MapPin, Monitor } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useSites } from '@/modules/sites/hooks/useSites';
import { getScreens } from '@/modules/scada/services/scada.service';
import type { ScadaScreen } from '@/modules/scada/types/scada.types';
import ScadaListPage from '@/modules/scada/pages/scada-list.page';
import ScadaViewerPage from '@/modules/scada/pages/scada-viewer.page';

const VIEWER_ONLY_ROLES = new Set(['CLIENTE', 'VISUALIZADOR']);

/** Experiência do cliente: vê a tela do seu site embutida no BlueBee (sem lista/edição). */
function ClientViewer() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('screen');
  const user = useCurrentUser();
  const { selectedSiteId, setSite } = useSiteFilter();

  const { data: sites = [], isLoading: loadingSites } = useSites(user.tenantId ?? undefined);

  // Com um único site, usa-o direto; com vários e nenhum selecionado, mostra o seletor.
  const onlySiteId = sites.length === 1 ? sites[0].id : undefined;
  const activeSiteId = selectedSiteId ?? onlySiteId;
  const showChooser = !selectedSiteId && sites.length > 1;

  const { data: screens = [], isLoading } = useQuery<ScadaScreen[]>({
    queryKey: ['scada-screens', activeSiteId ?? 'all'],
    queryFn: () => getScreens(activeSiteId ? { siteId: activeSiteId } : {}),
    enabled: !loadingSites && !showChooser,
  });

  if (loadingSites) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 animate-[fadeInUp_0.35s_ease-out_backwards]">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 ring-1 ring-cyan-200/50 dark:ring-cyan-200/30">
          <Loader2 className="h-5 w-5 animate-spin text-primary dark:text-ring" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-muted-foreground">Carregando seus sites…</p>
      </div>
    );
  }

  // Vários sites e nenhum selecionado: o cliente escolhe qual site visualizar.
  if (showChooser) {
    const firstName = user.name.split(' ')[0];
    return (
      <div className="mx-auto flex h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-10 sm:px-0">
        <div
          className="text-center animate-[fadeInUp_0.35s_ease-out_backwards]"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-50 to-cyan-100 ring-1 ring-cyan-200/60 dark:from-cyan-50 dark:to-cyan-100 dark:ring-cyan-200/40">
            <MapPin className="h-7 w-7 text-primary dark:text-ring" strokeWidth={1.5} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Olá, {firstName}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Selecione um site
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Escolha qual dos seus sites deseja visualizar agora.
          </p>
        </div>
        <ul className="space-y-2.5">
          {sites.map((s, i) => {
            const projects = s._count?.projects;
            return (
              <li
                key={s.id}
                className="animate-[fadeInUp_0.35s_ease-out_backwards]"
                style={{ animationDelay: `${80 + i * 60}ms` }}
              >
                <button
                  type="button"
                  onClick={() => setSite(s.id)}
                  className="group flex w-full items-center gap-3.5 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:hover:border-ring/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 ring-1 ring-cyan-200/50 transition-colors group-hover:bg-cyan-100 dark:ring-cyan-200/30">
                    <MapPin className="h-5 w-5 text-primary dark:text-ring" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {s.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {typeof projects === 'number'
                        ? `${projects} ${projects === 1 ? 'projeto' : 'projetos'}`
                        : 'Toque para visualizar'}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary dark:group-hover:text-ring"
                    strokeWidth={1.5}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        Carregando sua tela…
      </div>
    );
  }

  if (screens.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Monitor className="h-10 w-10 text-muted-foreground" strokeWidth={1} />
        <p className="mt-3 text-sm font-medium text-foreground">Nenhuma tela disponível</p>
        <p className="mt-1 text-xs text-muted-foreground">Aguarde o integrador configurar a sua tela.</p>
      </div>
    );
  }

  // Sem tela pedida na URL: abre a tela inicial (home) do projeto; senão, a primeira.
  const active =
    screens.find((s) => s.id === requested) ?? screens.find((s) => s.isHome) ?? screens[0];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {screens.length > 1 && (
        <div className="flex items-center gap-2 px-1 pb-2">
          <span className="text-xs text-muted-foreground">Tela:</span>
          <select
            value={active.id}
            onChange={(e) => router.replace(`/scada?screen=${e.target.value}`)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-border">
        <ScadaViewerPage screenId={active.id} embedded />
      </div>
    </div>
  );
}

export default function Page() {
  const user = useCurrentUser();

  if (VIEWER_ONLY_ROLES.has(user.role)) return <ClientViewer />;

  return <ScadaListPage />;
}
