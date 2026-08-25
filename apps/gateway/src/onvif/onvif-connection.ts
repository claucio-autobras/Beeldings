/* eslint-disable @typescript-eslint/no-explicit-any */
// A lib 'onvif' é JS puro (sem typings) — usamos require + tipos mínimos locais.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Cam } = require('onvif');

/** Timeout de conexão/requisição ONVIF (ms). */
export const ONVIF_TIMEOUT_MS = 10_000;

/** Informações do dispositivo retornadas por GetDeviceInformation. */
export interface OnvifDeviceInformation {
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  serialNumber: string | null;
}

/** Classificação do erro de conexão ONVIF (mensagens claras na UI). */
export type OnvifErrorCode = 'AUTH' | 'UNREACHABLE' | 'NOT_ONVIF' | 'UNKNOWN';

export class OnvifConnectionError extends Error {
  constructor(
    public readonly code: OnvifErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OnvifConnectionError';
  }
}

/** Instância mínima da Cam da lib onvif que usamos. */
export interface OnvifCam {
  on(event: string, cb: (...args: any[]) => void): void;
  removeAllListeners(event?: string): void;
  getDeviceInformation(cb: (err: Error | null, info?: any) => void): void;
  getStreamUri(options: any, cb: (err: Error | null, stream?: { uri?: string }) => void): void;
  getSnapshotUri(options: any, cb: (err: Error | null, res?: { uri?: string }) => void): void;
  capabilities?: { events?: unknown };
}

/** GetSnapshotUri → URI HTTP do snapshot JPEG (null quando a câmera não expõe). */
export function getSnapshotUri(cam: OnvifCam): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      cam.getSnapshotUri({}, (err, res) => {
        resolve(!err && res?.uri ? res.uri : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** GetStreamUri (RTSP) → URI do stream (null quando indisponível). */
export function getRtspStreamUri(cam: OnvifCam): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      cam.getStreamUri({ protocol: 'RTSP' }, (err, stream) => {
        resolve(!err && stream?.uri ? stream.uri : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Classifica o erro cru da lib onvif num código acionável (sem vazar credenciais). */
export function classifyOnvifError(err: Error): OnvifConnectionError {
  const msg = (err?.message ?? String(err)).toLowerCase();
  if (
    msg.includes('not authorized') ||
    msg.includes('unauthorized') ||
    msg.includes('401') ||
    msg.includes('wrong user') ||
    msg.includes('sender not authorized') ||
    msg.includes('auth')
  ) {
    return new OnvifConnectionError(
      'AUTH',
      'A câmera recusou o usuário/senha informados. Verifique as credenciais ONVIF.',
    );
  }
  if (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up')
  ) {
    return new OnvifConnectionError(
      'UNREACHABLE',
      'A câmera não respondeu no IP/porta ONVIF informados. Verifique o IP e a porta, e se o ONVIF está habilitado na câmera — em muitas marcas (ex.: Hikvision) ele vem desabilitado de fábrica e é preciso ativar "Open Network Video Interface" e criar um usuário ONVIF nas configurações da própria câmera.',
    );
  }
  if (msg.includes('xml') || msg.includes('parse') || msg.includes('soap') || msg.includes('404')) {
    return new OnvifConnectionError(
      'NOT_ONVIF',
      'O dispositivo respondeu, mas não parece falar ONVIF nessa porta. Muitas câmeras (ex.: Hikvision) vêm com ONVIF desabilitado de fábrica: ative "Open Network Video Interface" e crie um usuário ONVIF nas configurações da câmera. Verifique também a porta do serviço ONVIF (geralmente 80, 8080, 8000 ou 2020).',
    );
  }
  return new OnvifConnectionError('UNKNOWN', 'Falha ao conectar via ONVIF na câmera.');
}

/**
 * Conecta numa câmera ONVIF (descoberta de serviços + autenticação).
 * Rejeita com OnvifConnectionError classificado; nunca inclui a senha na mensagem.
 */
export function connectOnvif(params: {
  ip: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}): Promise<OnvifCam> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          new OnvifConnectionError(
            'UNREACHABLE',
            'A câmera não respondeu no tempo esperado. Verifique o IP e a porta ONVIF.',
          ),
        );
      }
    }, params.timeoutMs ?? ONVIF_TIMEOUT_MS);

    try {
      const cam: OnvifCam = new Cam(
        {
          hostname: params.ip,
          username: params.username,
          password: params.password,
          port: params.port,
          timeout: params.timeoutMs ?? ONVIF_TIMEOUT_MS,
        },
        (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (err) {
            reject(classifyOnvifError(err));
          } else {
            resolve(cam);
          }
        },
      );
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(classifyOnvifError(err as Error));
      }
    }
  });
}

/**
 * Lê GetDeviceInformation (fabricante/modelo/firmware/série).
 *
 * Timeout explícito: algumas câmeras em campo aceitam a conexão TCP mas nunca
 * respondem ao SOAP — o callback da lib jamais dispara e a Promise ficaria
 * pendurada para sempre (ciclo de polling preso em "busy" até reiniciar o
 * gateway). O estouro rejeita como UNREACHABLE; o chamador trata como falha do
 * ciclo e reconecta no próximo.
 */
export function getDeviceInformation(
  cam: OnvifCam,
  timeoutMs: number = ONVIF_TIMEOUT_MS,
): Promise<OnvifDeviceInformation> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          new OnvifConnectionError(
            'UNREACHABLE',
            'A câmera não respondeu ao GetDeviceInformation no tempo esperado.',
          ),
        );
      }
    }, timeoutMs);
    timer.unref?.();

    try {
      cam.getDeviceInformation((err, info) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          reject(classifyOnvifError(err));
          return;
        }
        resolve({
          manufacturer: info?.manufacturer ?? null,
          model: info?.model ?? null,
          firmwareVersion: info?.firmwareVersion ?? null,
          serialNumber: info?.serialNumber ?? null,
        });
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(classifyOnvifError(err as Error));
      }
    }
  });
}
