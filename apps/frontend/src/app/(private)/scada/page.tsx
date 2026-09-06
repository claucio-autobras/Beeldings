'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, Loader2, MapPin, Monitor } from 'lucide-react';
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

  // Um site salvo no navegador só vale se ainda pertence ao cliente atual.
  // Com um único site, usa-o direto; com vários e nenhum selecionado, mostra o seletor.
  const selectedSiteIsCurrent = Boolean(selectedSiteId && sites.some((site) => site.id === selectedSiteId));
  const onlySiteId = sites.length === 1 ? sites[0].id : undefined;
  const activeSiteId = selectedSiteIsCurrent ? (selectedSiteId ?? undefined) : onlySiteId;
  const showChooser = !selectedSiteIsCurrent && sites.length > 1;

  const { data: screens = [], isLoading } = useQuery<ScadaScreen[]>({
    queryKey: ['scada-screens', activeSiteId ?? 'all'],
    queryFn: () => getScreens(activeSiteId ? { siteId: activeSiteId } : {}),
    enabled: !loadingSites && !showChooser && Boolean(activeSiteId),
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
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6">
        <div className="text-center animate-[fadeInUp_0.35s_ease-out_backwards]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-gradient-to-br from-cyan-50 via-cyan-100 to-sky-100 shadow-[0_12px_30px_-16px_rgba(8,145,178,0.7)] ring-1 ring-cyan-200/70 dark:from-cyan-50 dark:via-cyan-100 dark:to-sky-100 dark:ring-cyan-200/40">
            <MapPin className="h-7 w-7 text-primary dark:text-ring" strokeWidth={1.5} />
          </div>
          <p className="mt-5 text-sm font-medium text-primary/80 dark:text-ring/90">Olá, {firstName}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Selecione um site
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Escolha o ambiente que deseja visualizar.
          </p>
        </div>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {sites.map((s, i) => (
            <li
              key={s.id}
              className="animate-[fadeInUp_0.35s_ease-out_backwards]"
              style={{ animationDelay: `${80 + i * 60}ms` }}
            >
              <button
                type="button"
                onClick={() => setSite(s.id)}
                aria-label={`Acessar ${s.name}`}
                className="group relative flex min-h-[116px] w-full items-center gap-4 overflow-hidden rounded-2xl border border-border/80 bg-card/95 p-4 text-left shadow-[0_8px_24px_-18px_rgba(15,23,42,0.55)] transition-all duration-200 hover:-translate-y-1 hover:border-cyan-300 hover:shadow-[0_18px_34px_-20px_rgba(8,145,178,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-slate-700/80 dark:bg-slate-900/90 dark:hover:border-cyan-700"
              >
                <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-300 via-cyan-500 to-sky-500 opacity-70 transition-opacity group-hover:opacity-100" />
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-50 to-sky-100 text-primary ring-1 ring-cyan-200/70 transition-transform duration-200 group-hover:scale-105 dark:from-cyan-950/70 dark:to-sky-950/60 dark:text-cyan-300 dark:ring-cyan-800/70">
                  <MapPin className="h-5 w-5" strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                    Site {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="block truncate text-[15px] font-semibold text-foreground">
                    {s.name}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {s.location?.trim() || 'Visualizar ambiente'}
                  </span>
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-all duration-200 group-hover:border-cyan-200 group-hover:bg-cyan-50 group-hover:text-primary dark:group-hover:border-cyan-800 dark:group-hover:bg-cyan-950/60 dark:group-hover:text-cyan-300">
                  <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.8} />
                </span>
              </button>
            </li>
          ))}
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
      <div className="flex h-full flex-col">
        <div className="flex items-center px-1 pb-3">
          {sites.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                setSite(null);
                router.replace('/scada');
              }}
              className="group inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" strokeWidth={1.8} />
              Voltar para sites
            </button>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <Monitor className="h-10 w-10 text-muted-foreground" strokeWidth={1} />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhuma tela disponível</p>
          <p className="mt-1 text-xs text-muted-foreground">Aguarde o integrador configurar a sua tela.</p>
        </div>
      </div>
    );
  }

  // Sem tela pedida na URL: abre a tela inicial (home) do projeto; senão, a primeira.
  const active =
    screens.find((s) => s.id === requested) ?? screens.find((s) => s.isHome) ?? screens[0];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between gap-3 px-1 pb-3">
        {sites.length > 1 ? (
          <button
            type="button"
            onClick={() => {
              setSite(null);
              router.replace('/scada');
            }}
            className="group inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" strokeWidth={1.8} />
            Voltar para sites
          </button>
        ) : <span />}
        {screens.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Tela</span>
            <select
              value={active.id}
              onChange={(e) => router.replace(`/scada?screen=${e.target.value}`)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            >
              {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-border">
        <ScadaViewerPage screenId={active.id} siteId={activeSiteId} embedded />
      </div>
    </div>
  );
}

export default function Page() {
  const user = useCurrentUser();

  if (VIEWER_ONLY_ROLES.has(user.role)) return <ClientViewer />;

  return <ScadaListPage />;
}
