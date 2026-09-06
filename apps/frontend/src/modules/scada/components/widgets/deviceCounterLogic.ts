import type { DeviceCounterWidget } from '../../types/scada.types';
import { matchOperator, toScadaNumber } from '../../types/scada.types';
import type { PointStatus } from '../../hooks/useScreenTelemetry';
import { isCameraDevice, type ScreenDevice } from '../../types/virtual.types';
import type { Camera } from '@/modules/cftv/services/cftv.service';
import type { CameraHealth } from '@/modules/cftv/utils/telemetry-format';

export type GetValue = (deviceId: string, tag: string) => number | boolean | string | null;
export type GetTagStatus = (deviceId: string, tag: string) => PointStatus;

/**
 * Callback que devolve a saúde canônica de uma câmera (STATUS + liveness do
 * gateway + frescor dos dados) — espelha cameraHealthInfo() da área CFTV.
 * Quando fornecido ao countDevices, o modo 'connectivity' usa este critério
 * para câmeras em vez de ler o ponto STATUS diretamente (que pode estar
 * congelado com gateway offline).
 */
export type GetCameraHealth = (camera: Camera) => CameraHealth;

/** Resultado da contagem: ligados / desligados / sem-dados / total elegível. */
export interface DeviceCounterResult {
  on: number;
  off: number;
  noData: number;
  total: number;
}

/** Estado de UMA unidade contada (dispositivo ou ponto) segundo o modo do widget. */
export type CountState = 'on' | 'off' | 'no-data';

/** Detalhe de UM ponto do modo point-list, para o popup "quais estão ligados". */
export interface CounterPointDetail {
  deviceId: string;
  deviceName: string;
  tag: string;
  /** Nome amigável do ponto quando existir (objectName); senão a própria tag. */
  pointName: string;
  state: CountState;
}

/** Dispositivos elegíveis: exclui virtuais (Bancada) e aplica filtro + escopo. */
export function eligibleDevices(w: DeviceCounterWidget, devices: ScreenDevice[]): ScreenDevice[] {
  return devices.filter((d) => {
    if (d.protocol === 'virtual') return false; // Bancada NUNCA conta
    if (w.deviceFilter === 'camera' && !isCameraDevice(d)) return false;
    if (w.deviceFilter === 'other' && isCameraDevice(d)) return false;
    if (w.scope === 'selected' && !w.deviceIds.includes(d.id)) return false;
    return true;
  });
}

/**
 * Avalia UM ponto (device + tag) contra a condição do widget, com a mesma
 * semântica do modo point-value: sem valor / leitura não-live → "sem dados"
 * (nunca desligado silencioso); câmeras usam o seed persistido como na área CFTV.
 */
function evaluatePoint(
  w: DeviceCounterWidget,
  d: ScreenDevice,
  tag: string,
  getValue: GetValue,
  getTagStatus?: GetTagStatus,
): CountState {
  if (!tag || !d.points.some((p) => p.tag === tag)) return 'no-data';
  const v = getValue(d.id, tag);
  if (v === null) return 'no-data';
  if (!isCameraDevice(d) && getTagStatus && getTagStatus(d.id, tag) !== 'live') {
    return 'no-data';
  }
  const n = toScadaNumber(v);
  if (Number.isNaN(n)) return 'no-data';
  return matchOperator(n, w.operator, w.value) ? 'on' : 'off';
}

/**
 * Contagem por lista explícita de pontos (modo point-list): cada ponto
 * selecionado (deviceId + tag) é uma unidade; pontos de dispositivos virtuais
 * (Bancada) ou de dispositivos ausentes da tela são ignorados (não entram no total).
 */
export function countPoints(
  w: DeviceCounterWidget,
  devices: ScreenDevice[],
  getValue: GetValue,
  getTagStatus?: GetTagStatus,
): DeviceCounterResult {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const result: DeviceCounterResult = { on: 0, off: 0, noData: 0, total: 0 };
  for (const ref of w.points ?? []) {
    const d = byId.get(ref.deviceId);
    if (!d || d.protocol === 'virtual') continue; // virtual/ausente: fora do total
    result.total += 1;
    const s = evaluatePoint(w, d, ref.tag, getValue, getTagStatus);
    if (s === 'on') result.on += 1;
    else if (s === 'off') result.off += 1;
    else result.noData += 1;
  }
  return result;
}

/**
 * Lista o estado de CADA ponto selecionado no modo point-list, na mesma ordem
 * da seleção e com a MESMA semântica de countPoints (stale/sem valor = "sem
 * dados"); pontos virtuais/ausentes são omitidos, como na contagem.
 */
export function listCounterPoints(
  w: DeviceCounterWidget,
  devices: ScreenDevice[],
  getValue: GetValue,
  getTagStatus?: GetTagStatus,
): CounterPointDetail[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out: CounterPointDetail[] = [];
  for (const ref of w.points ?? []) {
    const d = byId.get(ref.deviceId);
    if (!d || d.protocol === 'virtual') continue;
    const p = d.points.find((pt) => pt.tag === ref.tag);
    const pointName =
      (p && 'objectName' in p && typeof p.objectName === 'string' && p.objectName.trim()) || ref.tag;
    out.push({
      deviceId: d.id,
      deviceName: d.name,
      tag: ref.tag,
      pointName,
      state: evaluatePoint(w, d, ref.tag, getValue, getTagStatus),
    });
  }
  return out;
}

/**
 * Conta segundo o modo:
 * - connectivity: câmera = critério canônico CFTV via getCameraHealth (STATUS +
 *   liveness do gateway + frescor); sem getCameraHealth cai no valor bruto do
 *   STATUS (retrocompatibilidade). Demais = frescor da telemetria (algum ponto
 *   `live` → online; algum ponto já visto (`stale`) → offline; nada → sem dados).
 * - point-value: valor do ponto `pointTag` por dispositivo comparado à condição.
 *   Dispositivo offline/sem valor → sem dados (nunca "desligado" silencioso).
 * - point-list: cada ponto selecionado (deviceId + tag) conta individualmente
 *   contra a mesma condição (ex.: 5/10 lâmpadas).
 *
 * @param getCameraHealth  Callback opcional que devolve a saúde canônica de uma
 *   câmera (cameraHealthInfo da área CFTV: STATUS + gateway liveness + frescor).
 *   Quando fornecido, o modo 'connectivity' usa-o em vez do STATUS bruto, evitando
 *   que uma câmera seja contada como online quando o gateway está offline.
 */
export function countDevices(
  w: DeviceCounterWidget,
  devices: ScreenDevice[],
  getValue: GetValue,
  getTagStatus?: GetTagStatus,
  getCameraHealth?: GetCameraHealth,
): DeviceCounterResult {
  if (w.mode === 'point-list') return countPoints(w, devices, getValue, getTagStatus);

  const eligible = eligibleDevices(w, devices);

  function connectivityState(d: ScreenDevice): CountState {
    if (isCameraDevice(d)) {
      if (getCameraHealth) {
        const health = getCameraHealth(d);
        if (health === 'online') return 'on';
        if (health === 'offline') return 'off';
        return 'no-data'; // 'unknown'
      }
      // Fallback (sem getCameraHealth): valor bruto do STATUS sem checagem de
      // gateway/frescor — retrocompatibilidade quando o widget não tem getTagReading.
      const n = toScadaNumber(getValue(d.id, 'STATUS'));
      if (Number.isNaN(n)) return 'no-data';
      return n >= 1 ? 'on' : 'off';
    }
    if (!getTagStatus) {
      // Sem resolvedor de frescor (fallback): valor presente = online.
      return d.points.some((p) => getValue(d.id, p.tag) !== null) ? 'on' : 'no-data';
    }
    let seen = false;
    for (const p of d.points) {
      const s = getTagStatus(d.id, p.tag);
      if (s === 'live') return 'on';
      if (s === 'stale') seen = true;
    }
    return seen ? 'off' : 'no-data';
  }

  const result: DeviceCounterResult = { on: 0, off: 0, noData: 0, total: eligible.length };
  for (const d of eligible) {
    const s = w.mode === 'connectivity'
      ? connectivityState(d)
      : evaluatePoint(w, d, w.pointTag, getValue, getTagStatus);
    if (s === 'on') result.on += 1;
    else if (s === 'off') result.off += 1;
    else result.noData += 1;
  }
  return result;
}

export function formatCount(w: DeviceCounterWidget, r: DeviceCounterResult): string {
  switch (w.format) {
    case 'on-only': return String(r.on);
    case 'off-only': return String(r.off);
    case 'total-only': return String(r.total);
    case 'fraction':
    default: return `${r.on}/${r.total}`;
  }
}
