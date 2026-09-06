'use client';

import { io, Socket } from 'socket.io-client';

/**
 * Socket COMPARTILHADO do namespace /telemetry.
 *
 * Antes, cada hook (useBacnetTelemetry no Topbar, no popup de alarmes, no
 * viewer SCADA; useAlarmRealtime na página de alarmes…) chamava `io()` por
 * conta própria. O socket.io-client reaproveita o MESMO socket de namespace
 * para a mesma URL/path — então o `socket.disconnect()` do cleanup de um
 * componente derrubava o socket dos demais, que reconectavam em seguida.
 * Somado ao double-mount do StrictMode (conecta → desconecta no meio do
 * handshake → reconecta), isso gerava os avisos repetidos no console:
 * "WebSocket is closed before the connection is established".
 *
 * Este módulo centraliza o ciclo de vida com contagem de referências:
 * - `acquireTelemetrySocket()` conecta (ou reaproveita) o socket único.
 * - `releaseTelemetrySocket()` decrementa; só desconecta de verdade após um
 *   LINGER curto com zero consumidores — o remount imediato do StrictMode e
 *   navegações entre páginas reutilizam a mesma conexão sem churn.
 * - Consumidores registram listeners próprios e removem SÓ os próprios
 *   (`socket.off(event, handler)`), nunca `socket.disconnect()`.
 *
 * Escopo de tenant: o backend trava usuários de tenant no próprio tenant;
 * papéis globais estreitam via `scope:subscribe`. Como o filtro de tenant é
 * um store global (useTenantFilter), todos os consumidores enxergam o mesmo
 * valor — `setTelemetryScope()` reemite no socket vivo (sem reconectar) e o
 * módulo reemite automaticamente a cada `connect`.
 */

// Mesma origem do frontend, encaminhado ao backend pelo rewrite `/api/*` do
// Next (ver next.config.ts). No Replit a porta 4000 não é exposta ao
// navegador, então conectamos via proxy com `path: '/api/socket.io'`.
const SOCKET_URL =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';
const SOCKET_PATH = '/api/socket.io';

/** Espera antes de desconectar com zero consumidores (StrictMode/navegação). */
const LINGER_MS = 2_000;

let socket: Socket | null = null;
let refCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/** Último escopo pedido — reemitido a cada (re)conexão. */
let currentScope: { tenantId: string | null } | null = null;

function createSocket(): Socket {
  const s = io(`${SOCKET_URL}/telemetry`, {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 3000,
    reconnectionDelayMax: 10000,
    // Autenticação via cookie de sessão HttpOnly enviado no handshake.
    withCredentials: true,
  });
  // Reassina o escopo a cada conexão/reconexão (rooms não sobrevivem à queda).
  s.on('connect', () => {
    if (currentScope) s.emit('scope:subscribe', currentScope);
  });
  return s;
}

/** Obtém o socket compartilhado, conectando se necessário. Parear com release. */
export function acquireTelemetrySocket(): Socket {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (!socket) socket = createSocket();
  else if (socket.disconnected) socket.connect();
  refCount += 1;
  return socket;
}

/** Libera uma referência; desconecta de fato só após o linger sem consumidores. */
export function releaseTelemetrySocket(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || releaseTimer) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (refCount === 0 && socket) {
      socket.disconnect();
      socket = null;
    }
  }, LINGER_MS);
}

/**
 * Define o escopo de tenant do stream (papéis globais). Emite no socket vivo
 * sem reconectar; o valor fica guardado e é reemitido a cada `connect`.
 */
export function setTelemetryScope(tenantId: string | null): void {
  currentScope = { tenantId };
  if (socket?.connected) socket.emit('scope:subscribe', currentScope);
}
