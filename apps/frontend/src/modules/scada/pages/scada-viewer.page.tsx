'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Loader2, Maximize2, Minimize2, Wifi, WifiOff } from 'lucide-react';
import { useViewer } from '../hooks/useViewer';
import { useScreenCommand } from '../hooks/useScreenCommand';
import { useProjectLayout } from '../hooks/useProjectLayout';
import { WidgetRenderer } from '../components/widgets/WidgetRenderer';
import { NavToolbarWidgetView } from '../components/widgets/NavToolbarWidget';
import { NavSidebarWidgetView } from '../components/widgets/NavSidebarWidget';
import { ViewerBenchPanel } from '../components/ViewerBenchPanel';
import { ToastNotification } from '../components/editor/ToastNotification';
import { NewAlarmPopupHost } from '@/components/NewAlarmPopupHost';
import { resolveAssetUrl } from '../services/scada.service';
import { isPinnedNavWidget, clampPinnedToolbarH, clampPinnedSidebarW } from '../types/scada.types';

interface Props {
  screenId: string;
  /** Renderiza embutido no layout do BlueBee (sem barra de voltar/standalone). */
  embedded?: boolean;
}

export default function ScadaViewerPage({ screenId, embedded = false }: Props) {
  const router = useRouter();

  // Tela atual: estado local para que a navegação dentro do projeto troque só o
  // conteúdo (sem remontar a página → as barras fixas não piscam).
  const [currentId, setCurrentId] = useState(screenId);
  // Ajuste durante o render (padrão "you might not need an effect"): quando a
  // rota muda, sincroniza a tela atual sem passar por um efeito.
  const [prevScreenId, setPrevScreenId] = useState(screenId);
  if (screenId !== prevScreenId) {
    setPrevScreenId(screenId);
    setCurrentId(screenId);
  }

  const { screen, loading, connected, getTagValue, getTagReading, getTagStatus, getGroupAggregate, devices } = useViewer(currentId);
  const sendCommand = useScreenCommand(devices);

  // Layout do projeto (barras fixas). Mantém o último projeto conhecido para o
  // shell não sumir enquanto a próxima tela carrega.
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  if (screen?.projectId && screen.projectId !== projectId) setProjectId(screen.projectId);
  const { layout } = useProjectLayout(projectId);
  const pinnedToolbar = layout?.toolbar ?? null;
  const pinnedSidebar = layout?.sidebar ?? null;
  const hasProjectLayout = Boolean(pinnedToolbar || pinnedSidebar);

  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState({ x: 1, y: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fit canvas to viewport
  useEffect(() => {
    if (!screen || !containerRef.current) return;
    function updateScale() {
      if (!screen || !containerRef.current) return;
      const { clientWidth: vw, clientHeight: vh } = containerRef.current;
      // Folha preenche TODA a área (edge-to-edge, sem faixas nem rolagem),
      // esticando cada eixo de forma independente.
      setScale({ x: vw / screen.width, y: vh / screen.height });
    }
    updateScale();
    const obs = new ResizeObserver(updateScale);
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [screen]);

  // Sincroniza estado com a API de fullscreen do navegador
  useEffect(() => {
    function onChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen();
    }
  }, []);

  const handleNavigate = useCallback((targetScreenId: string) => {
    if (!targetScreenId || targetScreenId === currentId) return;
    const url = embedded ? `/scada?screen=${targetScreenId}` : `/scada-view/${targetScreenId}`;
    // Dentro do projeto com layout fixo: troca só o conteúdo (estado local +
    // pushState) — evita a remontagem da rota e o flicker das barras.
    if (hasProjectLayout && layout?.screenIds.includes(targetScreenId)) {
      setCurrentId(targetScreenId);
      window.history.pushState(null, '', url);
      return;
    }
    router.push(url);
  }, [currentId, embedded, hasProjectLayout, layout, router]);

  // Voltar/avançar do navegador após pushState: ressincroniza a tela pela URL.
  useEffect(() => {
    function onPop() {
      const m = embedded
        ? new URLSearchParams(window.location.search).get('screen')
        : window.location.pathname.match(/\/scada-view\/([^/?#]+)/)?.[1];
      if (m) setCurrentId(m);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [embedded]);

  // Primeiro carregamento (sem shell conhecido) mantém os estados simples.
  if (loading && !screen && !hasProjectLayout) {
    return (
      <div className={`scada-dark-chrome flex ${embedded ? 'h-full' : 'h-screen'} items-center justify-center gap-2 bg-slate-950 text-slate-400 text-sm`}>
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        Carregando tela…
      </div>
    );
  }

  if (!screen && !loading && !hasProjectLayout) {
    return (
      <div className={`scada-dark-chrome flex ${embedded ? 'h-full' : 'h-screen'} items-center justify-center bg-slate-950 text-slate-400 text-sm`}>
        Tela não encontrada
      </div>
    );
  }

  // Barras fixas nunca renderizam no canvas (aparecem encaixadas no shell).
  const sortedWidgets = screen
    ? screen.widgets.filter((w) => !isPinnedNavWidget(w)).sort((a, b) => a.zIndex - b.zIndex)
    : [];
  const bgImageUrl = screen ? resolveAssetUrl(screen.settings.backgroundImage) : undefined;

  const toolbarH = pinnedToolbar ? clampPinnedToolbarH(pinnedToolbar.widget.height) : 0;
  const sidebarW = pinnedSidebar ? clampPinnedSidebarW(pinnedSidebar.widget.width) : 0;

  return (
    <div ref={rootRef} className={`scada-dark-chrome flex ${embedded ? 'h-full' : 'h-screen'} min-h-0 flex-col overflow-hidden bg-slate-950`}>
      {/* Top bar */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-3 min-w-0">
          {!embedded && (
            <button
              type="button"
              onClick={() => router.push('/scada')}
              className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <nav className="flex items-center gap-1 text-xs text-slate-500 min-w-0">
            <span className="whitespace-nowrap">SCADA</span>
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate text-slate-300">{screen?.name ?? '…'}</span>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Status de conexão da telemetria */}
          <span className={`flex items-center gap-1.5 text-[11px] font-medium ${connected ? 'text-green-400' : 'text-slate-500'}`}>
            {connected ? <Wifi className="h-3.5 w-3.5" strokeWidth={1.5} /> : <WifiOff className="h-3.5 w-3.5" strokeWidth={1.5} />}
            {connected ? 'Ao vivo' : 'Sem telemetria'}
          </span>
          {/* Fullscreen */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
            {isFullscreen ? 'Sair' : 'Tela cheia'}
          </button>
        </div>
      </header>

      {/* Toolbar fixa do projeto — permanece montada durante a navegação. */}
      {pinnedToolbar && (
        <div style={{ height: toolbarH, flexShrink: 0 }} data-testid="pinned-toolbar">
          <NavToolbarWidgetView
            widget={pinnedToolbar.widget}
            currentScreenId={currentId}
            currentScreenName={screen?.name}
            onNavigate={handleNavigate}
          />
        </div>
      )}

      <div className="flex flex-1 min-h-0 min-w-0">
        {/* Sidebar fixa do projeto — permanece montada durante a navegação. */}
        {pinnedSidebar && (
          <div style={{ width: sidebarW, flexShrink: 0 }} data-testid="pinned-sidebar">
            <NavSidebarWidgetView
              widget={pinnedSidebar.widget}
              currentScreenId={currentId}
              currentScreenName={screen?.name}
              onNavigate={handleNavigate}
            />
          </div>
        )}

        {/* Canvas area — a folha preenche a área restante (espaço das barras já reservado). */}
        <div ref={containerRef} className="relative flex-1 min-h-0 min-w-0 overflow-hidden flex items-center justify-center bg-slate-900">
          {screen ? (
            <div
              style={{
                position: 'relative',
                width: screen.width,
                height: screen.height,
                transform: `scale(${scale.x}, ${scale.y})`,
                transformOrigin: 'center center',
                backgroundColor: screen.settings.backgroundColor ?? '#1a1a2e',
                backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                flexShrink: 0,
              }}
            >
              {sortedWidgets.map((widget) => (
                <WidgetRenderer
                  key={widget.id}
                  widget={widget}
                  getTagValue={getTagValue}
                  getTagStatus={getTagStatus}
                  getTagReading={getTagReading}
                  devices={devices}
                  getGroupAggregate={getGroupAggregate}
                  onCommand={sendCommand}
                  onNavigate={handleNavigate}
                  currentScreenId={currentId}
                  isEditor={false}
                  screenScope={{ tenantId: screen.tenantId, siteId: screen.siteId }}
                />
              ))}
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              Carregando tela…
            </div>
          ) : (
            <div className="text-slate-400 text-sm">Tela não encontrada</div>
          )}

          {screen && <ViewerBenchPanel devices={devices} projectId={screen.projectId} />}
        </div>
      </div>

      {/* Feedback (sucesso/erro) das ações de clique nos widgets */}
      <ToastNotification />

      {/* Pop-up "Novo Alarme Recebido": a rota standalone (/scada-view) não tem
          Topbar, então o host precisa ser montado aqui. O portal dinâmico do
          modal (usePortalContainer) garante que ele apareça também em tela
          cheia. No modo embedded o Topbar já monta o host — evita duplicar. */}
      {!embedded && <NewAlarmPopupHost realtime />}
    </div>
  );
}
