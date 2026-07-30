'use client';

import { useEffect, useState } from 'react';

// Mesmo valor de DeviceStatusService.ONLINE_THRESHOLD_MS no backend — manter
// os dois sincronizados para que a UI considere "offline" no mesmo limiar.
export const STALE_THRESHOLD_MS = 45_000;

// Classes compartilhadas do banner "sem comunicação" (âmbar com variante dark
// suave — translúcido/escuro em vez do amber-50 sólido, ilegível no tema escuro).
export const NO_COMM_BANNER_CLASS =
  'flex items-start gap-2 border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200 rounded-lg px-4 py-2 text-sm';

// Classe das mensagens âmbar por ponto ("Sem resposta…"/"(obsoleto)").
export const NO_COMM_TEXT_CLASS = 'text-amber-600 dark:text-amber-400';

interface Options {
  /** Status conhecido do device na abertura da tela ('online' | 'offline'). */
  deviceStatus: string;
  /** Timestamp ISO da última telemetria recebida ao vivo (ou null). */
  lastUpdate: string | null;
  /** Loading inicial do socket de telemetria (useBacnetTelemetry). */
  initialLoad: boolean;
  /**
   * true quando `deviceStatus` é REATUALIZADO ao vivo (ex.: polling da lista de
   * devices para dispositivos MQTT com heartbeat). Nesse caso o status do
   * backend é a fonte de verdade: online suprime o "sem comunicação" mesmo sem
   * telemetria nova (equipamentos que só publicam na mudança de valor).
   */
  statusIsLive?: boolean;
}

/**
 * Detecção client-side de "sem comunicação" com o equipamento, extraída do
 * detalhe BACnet e compartilhada com MQTT/Modbus.
 *
 * O backend deriva o status de liveness da última comunicação (dentro de
 * ONLINE_THRESHOLD_MS). Enquanto o equipamento é conhecido como online, não
 * declaramos "sem comunicação" só porque a primeira telemetria ainda não chegou:
 * o gateway publica cada equipamento a cada ~15s, então a primeira leitura pode
 * demorar. Isso elimina o falso "offline" transitório ao abrir a tela.
 *
 * Porém `deviceStatus` é uma prop congelada na abertura (não é reavaliada
 * enquanto a tela fica aberta). Para NÃO suprimir o offline legítimo para sempre
 * — caso o equipamento caia logo antes de abrir a tela e nunca chegue a enviar a
 * primeira leitura — a supressão vale apenas por uma janela de carência contada a
 * partir da abertura, alinhada ao ONLINE_THRESHOLD_MS do backend (o mesmo instante
 * em que o backend passaria a reportar o equipamento como offline).
 */
export function useDeviceNoCommunication({ deviceStatus, lastUpdate, initialLoad, statusIsLive = false }: Options) {
  // "Relógio" que avança a cada ~1s enquanto a tela está aberta, usado só para
  // comparar com o lastUpdate (staleness 100% client-side).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const [openedAt] = useState(() => Date.now());
  const withinOnlineGrace = now - openedAt < STALE_THRESHOLD_MS;
  // Com status ao vivo (heartbeat), o online do backend vale sempre — não só na
  // janela de carência; o backend já considera a janela do heartbeat do device.
  const isKnownOnline = deviceStatus === 'online' && (statusIsLive || withinOnlineGrace);

  const hasTelemetry = lastUpdate !== null;
  // Recebeu telemetria mas ela ficou obsoleta (equipamento caiu com a tela aberta).
  // Com status ao vivo online, telemetria parada NÃO é obsolescência (o
  // equipamento publica só na mudança de valor; a presença vem do heartbeat).
  const isStale = hasTelemetry
    && now - new Date(lastUpdate).getTime() > STALE_THRESHOLD_MS
    && !(statusIsLive && deviceStatus === 'online');
  // Ainda aguardando a PRIMEIRA leitura chegar — não é offline de fato.
  const awaitingFirstRead = !hasTelemetry && (initialLoad || isKnownOnline);
  // Nunca recebeu telemetria e não há mais motivo para esperar.
  const neverResponded = !hasTelemetry && !initialLoad && !isKnownOnline;
  // "Sem comunicação": controla o banner e o texto das linhas sem valor.
  const noCommunication = isStale || neverResponded;

  return { isStale, awaitingFirstRead, noCommunication };
}
