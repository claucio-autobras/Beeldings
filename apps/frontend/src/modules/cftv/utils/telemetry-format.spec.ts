/**
 * Testes para cameraHealthInfo() — derivação canônica de saúde de câmera CFTV
 * com verificação de liveness do gateway.
 *
 * Cenários cobertos (do plano task-772):
 *  1. Gateway offline + STATUS=1 congelado (dado velho) → offline, reason='gateway_offline'
 *  2. Dado muito velho + gateway desconhecido (null) → unknown
 *  3. Gateway volta online + STATUS=1 publicado (dado recente) → online
 *  4. Gateway online + STATUS=0 → offline (sem reason)
 *  5. Não-regressão: gateway marcado offline mas dado é recente (<5min) → online
 *     (dado recente vence o LWT; cobre janela entre LWT e próximo heartbeat)
 *  6. Sem ponto STATUS → unknown
 *  7. Sem dado nenhum (lastValue null, sem telemetria ao vivo) → unknown
 *  8. STATUS ≥ 1, dado velho, gateway explicitamente online → online
 */

import { cameraHealthInfo } from './telemetry-format';
import type { Camera } from '../services/cftv.service';
import type { TelemetryMap } from '@/hooks/useBacnetTelemetry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STALE_AGE_MS = 6 * 60 * 1000; // 6 min — definitivamente velho (> CAMERA_STALE_MS=5min)
const FRESH_AGE_MS = 2 * 60 * 1000; // 2 min — recente (< CAMERA_STALE_MS=5min)

/** ISO timestamp deslocado do agora em `offsetMs` milissegundos (negativo = passado). */
function ts(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Câmera mínima para os testes. */
function makeCamera(opts: {
  hasStatusPoint?: boolean;
  lastValue?: number | null;
  lastValueAt?: string | null;
  gatewayOnline?: boolean | null;
}): Camera {
  const {
    hasStatusPoint = true,
    lastValue = null,
    lastValueAt = null,
    gatewayOnline = null,
  } = opts;
  return {
    id: 'cam-1',
    name: 'Câmera Teste',
    protocol: 'snmp',
    monitoringProtocol: 'snmp',
    onvifUsername: null,
    hasOnvifPassword: false,
    onvifPort: null,
    liveViewAvailable: false,
    deviceInfo: null,
    pendingValidation: false,
    manufacturer: null,
    estimatedOnlineSince: null,
    snmpHealth: null,
    site: '',
    siteId: null,
    tenantId: 't-1',
    gatewayId: 'gw-1',
    gatewayOnline,
    ip: '192.168.1.100',
    port: 161,
    snmpVersion: '2c',
    community: 'public',
    rtspUrl: null,
    pollingInterval: 30,
    status: 'offline',
    critical: false,
    lastCommunication: null,
    points: hasStatusPoint
      ? [
          {
            id: 'pt-1',
            tag: 'STATUS',
            objectName: 'Status',
            metric: 'status',
            oid: null,
            unsupported: false,
            unit: '',
            critical: false,
            lastValue,
            lastValueAt,
            lastValueState: null,
          },
        ]
      : [],
  } as unknown as Camera;
}

/** TelemetryMap vazia — sem telemetria ao vivo. */
const emptyLive: TelemetryMap = new Map();

/** TelemetryMap com uma leitura ao vivo do STATUS.
 * Chave = deviceTagKey(cameraId, 'STATUS') = `${cameraId}:tag:STATUS`.
 */
function liveWith(cameraId: string, value: number, timestamp: string): TelemetryMap {
  const map: TelemetryMap = new Map();
  // deviceTagKey formata como `${deviceId}:tag:${tag}` (ver useBacnetTelemetry.ts linha 89)
  map.set(`${cameraId}:tag:STATUS` as Parameters<TelemetryMap['set']>[0], {
    value,
    timestamp,
    unit: null,
  });
  return map;
}

// ─── Cenário 1: gateway offline + STATUS=1 congelado ─────────────────────────

describe('cenário 1 — gateway offline + STATUS=1 congelado (dado velho)', () => {
  it('retorna offline com reason=gateway_offline', () => {
    const camera = makeCamera({
      lastValue: 1,
      lastValueAt: ts(-STALE_AGE_MS), // dado velho (>5min)
      gatewayOnline: false,
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('offline');
    expect(result.reason).toBe('gateway_offline');
  });
});

// ─── Cenário 2: dado muito velho + gateway desconhecido ───────────────────────

describe('cenário 2 — dado muito velho + gatewayOnline=null', () => {
  it('retorna unknown (não inventa offline sem confirmação de gateway)', () => {
    const camera = makeCamera({
      lastValue: 1,
      lastValueAt: ts(-STALE_AGE_MS),
      gatewayOnline: null,
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('unknown');
    expect(result.reason).toBeUndefined();
  });
});

// ─── Cenário 3: gateway volta + dado recente (STATUS=1 publicado) ─────────────

describe('cenário 3 — gateway volta online + STATUS=1 recente', () => {
  it('retorna online quando dado é fresco (<5min), independente de gatewayOnline', () => {
    const camera = makeCamera({
      lastValue: 1,
      lastValueAt: ts(-FRESH_AGE_MS),
      gatewayOnline: true,
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('online');
    expect(result.reason).toBeUndefined();
  });

  it('retorna online também via telemetria ao vivo com timestamp recente', () => {
    const camera = makeCamera({ gatewayOnline: false }); // gateway offline
    const live = liveWith('cam-1', 1, ts(-FRESH_AGE_MS));
    const result = cameraHealthInfo(camera, live);
    // Dado recente vence o LWT
    expect(result.health).toBe('online');
  });

  it('aceita tag STATUS com capitalização legada no ponto persistido', () => {
    const camera = makeCamera({
      lastValue: null,
      lastValueAt: null,
      gatewayOnline: null,
    });
    camera.points[0].tag = 'status';
    const result = cameraHealthInfo(camera, liveWith('cam-1', 1, ts(-FRESH_AGE_MS)));
    expect(result.health).toBe('online');
  });
});

// ─── Cenário 4: gateway online + STATUS=0 ────────────────────────────────────

describe('cenário 4 — gateway online + STATUS=0', () => {
  it('retorna offline sem reason (câmera realmente off)', () => {
    const camera = makeCamera({
      lastValue: 0,
      lastValueAt: ts(-FRESH_AGE_MS),
      gatewayOnline: true,
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('offline');
    expect(result.reason).toBeUndefined();
  });

  it('retorna offline mesmo com dado velho e gateway online', () => {
    const camera = makeCamera({
      lastValue: 0,
      lastValueAt: ts(-STALE_AGE_MS),
      gatewayOnline: true,
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('offline');
    expect(result.reason).toBeUndefined();
  });
});

// ─── Cenário 5: não-regressão — gateway caiu mas dado ainda recente ───────────

describe('cenário 5 — não-regressão: LWT offline mas dado recente (<5min)', () => {
  it('retorna online (dado recente vence o LWT — janela de segurança)', () => {
    const camera = makeCamera({
      lastValue: 1,
      lastValueAt: ts(-FRESH_AGE_MS), // 2min atrás — gateway acabou de cair
      gatewayOnline: false,           // LWT chegou
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('online');
    expect(result.reason).toBeUndefined();
  });
});

// ─── Cenário 6: sem ponto STATUS ─────────────────────────────────────────────

describe('cenário 6 — câmera sem ponto STATUS cadastrado', () => {
  it('retorna unknown', () => {
    const camera = makeCamera({ hasStatusPoint: false });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('unknown');
  });
});

// ─── Cenário 7: sem dado nenhum ──────────────────────────────────────────────

describe('cenário 7 — ponto STATUS existe mas sem valor (lastValue=null, sem telemetria)', () => {
  it('retorna unknown', () => {
    const camera = makeCamera({ lastValue: null, lastValueAt: null, gatewayOnline: false });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('unknown');
  });
});

// ─── Cenário 8: gateway explicitamente online + dado velho ───────────────────

describe('cenário 8 — STATUS=1, dado velho, gateway explicitamente online', () => {
  it('retorna online (gateway confirma vida; câmera publica só na mudança)', () => {
    const camera = makeCamera({
      lastValue: 1,
      lastValueAt: ts(-STALE_AGE_MS),
      gatewayOnline: true,
    });
    const result = cameraHealthInfo(camera, emptyLive);
    expect(result.health).toBe('online');
    expect(result.reason).toBeUndefined();
  });
});

// ─── cameraHealth() wrapper ───────────────────────────────────────────────────

describe('cameraHealth() wrapper', () => {
  it('retorna apenas o health (string union), sem reason', async () => {
    const { cameraHealth } = await import('./telemetry-format');
    const camera = makeCamera({ lastValue: 1, lastValueAt: ts(-FRESH_AGE_MS), gatewayOnline: true });
    const result = cameraHealth(camera, emptyLive);
    expect(typeof result).toBe('string');
    expect(result).toBe('online');
  });
});
