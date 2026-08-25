'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Camera, Cpu, Gauge, Power, ShieldAlert, WifiOff } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { withBasePath } from '@/lib/routes';
import type { CriticalAsset } from '../services/dashboard.service';
import { useCameras } from '@/modules/cftv/hooks/useCameras';
import { FirstActionModal } from './FirstActionModal';
import { CriticalAssetInfoModal } from './CriticalAssetInfoModal';
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

const KIND_ICON = {
  camera: Camera,
  device: Cpu,
  point: Gauge,
} as const;

/**
 * Card "Ativos Críticos": itens marcados como críticos pelo operador, cada um
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
    <div className="flex h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldAlert size={16} className="text-cyan-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t('Ativos Críticos')}</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {t('Equipamentos e pontos sob vigilância')}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : !assets || assets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <ShieldAlert size={26} strokeWidth={1.5} className="text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">{t('Nenhum ativo crítico marcado')}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('Marque equipamentos ou pontos com a estrela em Dispositivos para acompanhá-los aqui')}
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {assets.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? Cpu;
            const longOffline = a.offlineMs !== null && a.offlineMs >= LONG_OFFLINE_MS;
            const bad = a.state === 'fault' || (a.state === 'no_response' && longOffline);
            return (
              <li key={`${a.kind}:${a.id}`}>
                <button
                  onClick={() => go(a)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/60 ${
                    bad ? 'bg-red-50/50 dark:bg-red-950/20' : ''
                  }`}
                >
                  <span
                    className={`rounded-md border p-1.5 ${
                      a.state === 'fault'
                        ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/60 dark:text-red-400'
                        : a.state === 'no_response'
                          ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                          : a.state === 'running'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : 'border-border bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <Icon size={14} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {a.name}
                      {a.kind === 'point' && (
                        <span className="text-muted-foreground"> · {a.deviceName}</span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[a.siteName, isAdmin ? a.tenantName : null].filter(Boolean).join(' — ') || t('Sem site')}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    {a.state === 'fault' ? (
                      <>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                          a.faultSeverity === 'HIGH' ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'
                        }`}>
                          <AlertTriangle size={11} />
                          {t('Em falha')}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {a.faultMs !== null ? `${t('há')} ${humanizeMs(a.faultMs, t)}` : t('Sem dados')}
                        </span>
                      </>
                    ) : a.state === 'no_response' ? (
                      <>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                          longOffline ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
                        }`}>
                          <WifiOff size={11} />
                          {t('Sem resposta')}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {a.offlineMs !== null
                            ? `${t('há')} ${humanizeMs(a.offlineMs, t)}`
                            : t('Sem dados')}
                        </span>
                      </>
                    ) : a.state === 'running' ? (
                      <>
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {t('Ligado')}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {a.activeMs !== null
                            ? `${t('há')} ${humanizeMs(a.activeMs, t)}`
                            : t('Sem dados')}
                        </span>
                      </>
                    ) : a.state === 'stopped' ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          <Power size={11} />
                          {t('Desligado')}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {a.stoppedMs !== null
                            ? `${t('há')} ${humanizeMs(a.stoppedMs, t)}`
                            : t('Sem dados')}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {t('Monitorando')}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
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
    </div>
  );
}
