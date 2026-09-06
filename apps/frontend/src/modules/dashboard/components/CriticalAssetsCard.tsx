'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { withBasePath } from '@/lib/routes';
import type { CriticalAsset } from '../services/dashboard.service';
import { useCameras } from '@/modules/cftv/hooks/useCameras';
import { FirstActionModal } from './FirstActionModal';
import { CriticalAssetInfoModal } from './CriticalAssetInfoModal';
import { DashboardPanel, DashboardSectionTitle } from './DashboardShared';
import {
  resolveAssetClick,
  resolveAssetNavigateHref,
  resolveInfoShortcut,
} from './criticalAssetClick';

interface CriticalAssetsCardProps {
  assets: CriticalAsset[] | undefined;
  /** Perfil com visão técnica (Admin/CCO/Supervisor): deep-link a Dispositivos. */
  isAdmin: boolean;
  isLoading?: boolean;
}

/** "3d 4h" / "2h 15m" / "12m" a partir de milissegundos. */
function humanizeMs(ms: number, t: (s: string) => string): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return t('agora mesmo');
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Offline "prolongado" (>= 24h) ganha destaque de risco. */
const LONG_OFFLINE_MS = 24 * 60 * 60 * 1000;

/**
 * Card "Pontos Críticos": itens marcados como críticos pelo operador, cada um
 * com estado atual + métrica operacional relevante — horas em funcionamento no
 * período, tempo contínuo em falha ou tempo offline. Clique contextual: falha
 * → Alarmes (highlight); câmera → CFTV; demais → SCADA (cliente, quando o
 * equipamento aparece numa tela) ou Dispositivos.
 */
export function CriticalAssetsCard({ assets, isAdmin, isLoading }: CriticalAssetsCardProps) {
  const t = useT();
  const router = useRouter();
  // Ativo em falha selecionado → painel "Primeira ação sugerida" (IA).
  const [firstActionAsset, setFirstActionAsset] = useState<CriticalAsset | null>(null);
  // Cliente: painel informativo do ativo (nunca navegação técnica direta).
  const [infoAsset, setInfoAsset] = useState<CriticalAsset | null>(null);

  // Câmeras do escopo (cache compartilhado com o card CFTV): identifica pontos
  // críticos de câmera para o deep-link ir ao contexto CFTV, não a Dispositivos.
  const { data: cameras = [] } = useCameras();
  const isCameraDevice = (deviceId: string) => cameras.some((c) => c.id === deviceId);
  const isCameraAsset = (a: CriticalAsset) =>
    a.kind === 'camera' || (a.kind === 'point' && isCameraDevice(a.deviceId));

  const clickCtx = (a: CriticalAsset) => ({ isAdmin, isCamera: isCameraAsset(a) });

  // Navegação contextual — também usada pelo botão do painel de primeira ação.
  // Técnico vai direto ao ponto: detalhe do dispositivo com o ponto em
  // destaque (câmera continua indo ao CFTV). Cliente só navega pelos atalhos
  // do painel informativo (nunca ao SCADA num item sem resposta).
  const navigate = (a: CriticalAsset) => {
    router.push(withBasePath(resolveAssetNavigateHref(a, clickCtx(a))));
  };

  // Clique: falha abre o painel de primeira ação (navegação contextual segue
  // disponível dentro dele); técnico navega direto; cliente vê o painel
  // informativo do ativo — nunca cai no SCADA com o ponto mudo.
  const go = (a: CriticalAsset) => {
    const action = resolveAssetClick(a, clickCtx(a));
    if (action.kind === 'firstAction') setFirstActionAsset(a);
    else if (action.kind === 'navigate') router.push(withBasePath(action.href));
    else setInfoAsset(a);
  };

  // Atalho contextual do painel informativo do cliente: CFTV para câmeras;
  // SCADA só quando o equipamento está numa tela ativa E responde.
  const infoAction = (a: CriticalAsset): { label: string; go: () => void } | null => {
    const shortcut = resolveInfoShortcut(a, clickCtx(a));
    if (!shortcut) return null;
    return {
      label: shortcut.label === 'cftv' ? t('Ver no CFTV') : t('Ver no SCADA'),
      go: () => router.push(withBasePath(shortcut.href)),
    };
  };

  return (
    <DashboardPanel className="p-5" accent>
      <DashboardSectionTitle
        eyebrow={t('Vigilância prioritária')}
        title={t('Pontos críticos')}
        detail={t('Equipamentos e pontos sob vigilância')}
        action={<ShieldAlert className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
      />

      <div className="critical-assets-scroll mt-4 min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[54px] animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : !assets || assets.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 py-6 text-center">
            <ShieldAlert size={26} strokeWidth={1.5} className="text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t('Nenhum ponto crítico marcado')}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('Marque equipamentos ou pontos com a estrela em Dispositivos para acompanhá-los aqui')}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {assets.map((a) => {
              const longOffline = a.offlineMs !== null && a.offlineMs >= LONG_OFFLINE_MS;
              const statusBarClass =
                a.state === 'fault'
                  ? 'bg-red-500'
                  : a.state === 'no_response'
                    ? 'bg-slate-400'
                    : a.state === 'running'
                      ? 'bg-emerald-500'
                      : 'bg-slate-500';
              const context = [
                a.siteName,
                a.kind === 'point' ? a.deviceName : isAdmin ? a.tenantName : null,
              ].filter(Boolean).join(' · ') || t('Sem site');
              return (
                <li key={`${a.kind}:${a.id}`}>
                  <button
                    onClick={() => go(a)}
                    className="dashboard-clickable critical-asset-item flex w-full items-center gap-3 rounded-xl border border-border bg-muted/50 p-3 text-left transition-colors hover:border-cyan-500/40 hover:bg-muted dark:bg-muted"
                  >
                    <span className={`h-9 w-1 shrink-0 rounded-full ${statusBarClass}`} aria-hidden />

                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13px] text-foreground">{a.name}</b>
                      <small className="block truncate text-[11px] text-muted-foreground">{context}</small>
                    </span>

                    <span className="shrink-0 text-right">
                      {a.state === 'fault' ? (
                        <>
                          <span className={`block text-[11px] font-bold ${
                            a.faultSeverity === 'HIGH' ? 'text-red-600 dark:text-red-300' : 'text-orange-600 dark:text-orange-300'
                          }`}>
                            {t('Em falha')}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {a.faultMs !== null ? `${t('há')} ${humanizeMs(a.faultMs, t)}` : t('Sem dados')}
                          </span>
                        </>
                      ) : a.state === 'no_response' ? (
                        <>
                          <span className={`block text-[11px] font-bold ${
                            longOffline ? 'text-red-600 dark:text-red-300' : 'text-slate-600'
                          }`}>
                            {t('Sem resposta')}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {a.offlineMs !== null
                              ? `${t('há')} ${humanizeMs(a.offlineMs, t)}`
                              : t('Sem dados')}
                          </span>
                        </>
                      ) : a.state === 'running' ? (
                        <>
                          <span className="block text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                            {t('Ligado')}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {a.activeMs !== null
                              ? `${t('há')} ${humanizeMs(a.activeMs, t)}`
                              : t('Sem dados')}
                          </span>
                        </>
                      ) : a.state === 'stopped' ? (
                        <>
                          <span className="block text-[11px] font-bold text-slate-600">
                            {t('Desligado')}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {a.stoppedMs !== null
                              ? `${t('há')} ${humanizeMs(a.stoppedMs, t)}`
                              : t('Sem dados')}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block text-[11px] font-bold text-muted-foreground">
                            {t('Monitorando')}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {t('Sem dados')}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {infoAsset && (
        <CriticalAssetInfoModal
          asset={infoAsset}
          actionLabel={infoAction(infoAsset)?.label}
          onAction={
            infoAction(infoAsset)
              ? () => {
                  const action = infoAction(infoAsset);
                  setInfoAsset(null);
                  action?.go();
                }
              : undefined
          }
          onClose={() => setInfoAsset(null)}
        />
      )}

      {firstActionAsset && (
        <FirstActionModal
          asset={firstActionAsset}
          onNavigate={() => {
            const a = firstActionAsset;
            setFirstActionAsset(null);
            navigate(a);
          }}
          onClose={() => setFirstActionAsset(null)}
        />
      )}
    </DashboardPanel>
  );
}
