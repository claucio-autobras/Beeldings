'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useAlarms, useMarkNoticesRead } from '@/modules/alarms/hooks/useAlarms';
import { useAlarmRealtime } from '@/modules/alarms/hooks/useAlarmEvents';
import { NewAlarmModal } from '@/modules/alarms/components/NewAlarmModal';
import type { Alarm } from '@/modules/alarms/types/alarm.types';
import { useNotificationPreferences } from '@/modules/preferences/preferences.store';
import { playNotificationSound } from '@/lib/notification-sound';

// Em modo mock, o pop-up de novo alarme é controlado pelo dashboard (botão de
// simulação); este host só atua em produção.
const IS_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

interface Props {
  /**
   * Abre a assinatura Socket.IO de alarmes. O Topbar já assina globalmente
   * (useAlarmRealtime), então só páginas SEM Topbar (ex.: viewer SCADA
   * standalone) devem passar true para manter o feed em tempo real.
   */
  realtime?: boolean;
  /** Callback opcional quando avisos de automação são marcados como lidos (ids). */
  onNoticesRead?: (ids: string[]) => void;
}

/**
 * Host autocontido do pop-up "Novo Alarme Recebido".
 *
 * Detecta alarmes que passaram a ACTIVE desde a última leitura da lista
 * (alimentada pelo socket/refetch) e exibe o NewAlarmModal. Extraído do Topbar
 * para poder ser montado também em páginas sem Topbar, como o viewer SCADA em
 * tela cheia (/scada-view/[screenId]).
 */
export function NewAlarmPopupHost({ realtime = false, onNoticesRead }: Props) {
  const user = useCurrentUser();
  const router = useRouter();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

  const { selectedTenantId } = useTenantFilter();
  const effectiveTenantId = isAdmin ? selectedTenantId : user.tenantId;

  useAlarmRealtime(realtime && !IS_MOCK);

  const alarmsQuery = useAlarms(effectiveTenantId ?? undefined);
  const notifPrefs = useNotificationPreferences();
  const markNoticesRead = useMarkNoticesRead();

  const [popupAlarms, setPopupAlarms] = useState<Alarm[]>([]);
  // IDs de alarmes já vistos (por tenant) — evita re-disparar o pop-up para
  // alarmes que já estavam ativos quando a tela carregou ou ao trocar de tenant.
  const seenActiveIds = useRef<Set<string> | null>(null);
  const seenTenantKey = useRef<string | null>(null);

  useEffect(() => {
    if (IS_MOCK) return;
    const data = alarmsQuery.data;
    if (!data) return; // aguarda a primeira carga

    const tenantKey = effectiveTenantId ?? 'all';
    const activeNow = data.filter((a) => a.status === 'ALARME');

    // Primeira carga ou troca de tenant: apenas semeia o baseline, sem disparar.
    if (seenActiveIds.current === null || seenTenantKey.current !== tenantKey) {
      seenActiveIds.current = new Set(activeNow.map((a) => a.id));
      seenTenantKey.current = tenantKey;
      return;
    }

    const novos = activeNow.filter((a) => !seenActiveIds.current!.has(a.id));
    if (novos.length === 0) return;

    novos.forEach((a) => seenActiveIds.current!.add(a.id));
    setPopupAlarms((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      return [...prev, ...novos.filter((n) => !ids.has(n.id))];
    });
    // Alerta sonoro (preferência do usuário).
    if (notifPrefs.soundEnabled) playNotificationSound();
  }, [alarmsQuery.data, effectiveTenantId, notifPrefs.soundEnabled]);

  if (IS_MOCK || popupAlarms.length === 0) return null;

  return (
    <NewAlarmModal
      alarms={popupAlarms}
      isAdmin={isAdmin}
      onDismiss={() => setPopupAlarms([])}
      onAcknowledgeNormalized={() => setPopupAlarms([])}
      onViewPanel={() => { setPopupAlarms([]); router.push('/alarms'); }}
      onMarkNoticesRead={(ids) => {
        onNoticesRead?.(ids);
        setPopupAlarms((prev) => prev.filter((p) => !ids.includes(p.id)));
        if (ids.length) markNoticesRead.mutate(ids);
      }}
    />
  );
}
