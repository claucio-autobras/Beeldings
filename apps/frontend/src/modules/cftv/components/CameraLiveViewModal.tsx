'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RefreshCw, Video, VideoOff, X } from 'lucide-react';
import { usePortalContainer } from '@/hooks/usePortalContainer';
import { useT } from '@/lib/i18n';
import { useCameraLiveView } from '../hooks/useCameraLiveView';

interface Props {
  /** Id da câmera ONVIF a visualizar. */
  cameraId: string;
  /** Nome exibido no cabeçalho. */
  cameraName: string;
  /** Subtítulo opcional (fabricante/modelo, site…). */
  subtitle?: string | null;
  /** Tenant efetivo (papéis globais) — repassado ao start da sessão. */
  tenantId?: string;
  onClose: () => void;
}

/** Formata o horário do último frame (HH:MM:SS local). */
function formatFrameTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('pt-BR', { hour12: false });
}

/**
 * Modal "Ver ao vivo" — imagem quase-ao-vivo (~1–2 fps) de uma câmera ONVIF.
 * Compartilhado pela página CFTV e pelo widget de câmera do SCADA. Renderizado
 * via portal no container correto (document.fullscreenElement quando o viewer
 * SCADA está em tela cheia). Fechar (botão, Escape, clique fora) encerra a
 * sessão imediatamente pelo cleanup do hook.
 */
export function CameraLiveViewModal({
  cameraId,
  cameraName,
  subtitle,
  tenantId,
  onClose,
}: Props) {
  const t = useT();
  const container = usePortalContainer();
  const { status, frameUrl, lastFrameAt, errorMessage, retry } =
    useCameraLiveView(cameraId, tenantId);

  // Escape fecha; foco inicial no botão de fechar (acessibilidade).
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!container) return null;

  const live = status === 'live';
  const frameTime = formatFrameTime(lastFrameAt);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Clique fora do painel fecha (mousedown evita fechar em drag-out).
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${t('Ver ao vivo')} — ${cameraName}`}
    >
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Video className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{cameraName}</p>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {live && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              {t('AO VIVO')}
            </span>
          )}
          {frameTime && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {t('último frame às')} {frameTime}
            </span>
          )}
          <button
            ref={closeRef}
            onClick={onClose}
            title={t('Fechar')}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Área de vídeo */}
        <div className="relative aspect-video w-full bg-black">
          {frameUrl && (
            // Frame JPEG efêmero via socket (data-URL) — next/image não se aplica.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={frameUrl}
              alt={cameraName}
              className="h-full w-full object-contain"
              draggable={false}
            />
          )}

          {/* Carregando (antes do primeiro frame) */}
          {status === 'connecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
              <p className="text-sm">{t('Conectando à câmera…')}</p>
              <p className="text-xs text-slate-500">
                {t('A primeira imagem pode levar alguns segundos.')}
              </p>
            </div>
          )}

          {/* Sinal perdido — frames pararam de chegar */}
          {status === 'signal_lost' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-slate-200">
              <VideoOff className="h-7 w-7 text-amber-400" />
              <p className="text-sm font-medium">{t('Sinal perdido')}</p>
              <p className="max-w-sm px-6 text-center text-xs text-slate-400">
                {t('A câmera parou de enviar imagens. Verifique a conexão da câmera ou do gateway.')}
              </p>
              <button
                onClick={retry}
                className="mt-1 flex items-center gap-2 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('Tentar de novo')}
              </button>
            </div>
          )}

          {/* Câmera sem suporte à captura de imagem */}
          {status === 'unsupported' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-slate-200">
              <VideoOff className="h-7 w-7 text-slate-400" />
              <p className="text-sm font-medium">{t('Visualização não suportada')}</p>
              <p className="max-w-sm px-6 text-center text-xs text-slate-400">
                {t('Esta câmera não expõe um método de captura de imagem compatível (snapshot ONVIF ou stream RTSP).')}
              </p>
            </div>
          )}

          {/* Erro de captura/credenciais/gateway */}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-slate-200">
              <VideoOff className="h-7 w-7 text-red-400" />
              <p className="text-sm font-medium">{t('Não foi possível exibir a imagem')}</p>
              <p className="max-w-sm px-6 text-center text-xs text-slate-400">
                {errorMessage || t('Falha ao obter imagens da câmera. Verifique o gateway e as credenciais ONVIF.')}
              </p>
              <button
                onClick={retry}
                className="mt-1 flex items-center gap-2 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('Tentar de novo')}
              </button>
            </div>
          )}
        </div>

        {/* Rodapé discreto */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2">
          <p className="text-[11px] text-muted-foreground">
            {t('Imagem quase em tempo real (~1–2 quadros por segundo).')}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('Fechar encerra a transmissão.')}
          </p>
        </div>
      </div>
    </div>,
    container,
  );
}
