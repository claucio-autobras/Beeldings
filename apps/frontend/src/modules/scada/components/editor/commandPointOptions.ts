import { isWritablePoint, isWritableAnalogPoint } from '../../hooks/useScreenCommand';
import type { ScreenDevice } from '../../types/virtual.types';

export interface Opt { value: string; label: string }

/** Rótulo do ponto no seletor: tag + tipo BACnet/virtual quando disponível. */
function pointOptLabel(p: { tag: string }): string {
  return 'objectType' in p ? `${p.tag} (${(p as { objectType: string }).objectType})` : p.tag;
}

/** Equipamentos com pelo menos um ponto comandável (BACnet, MQTT com escrita, Modbus holding/coil, bancada). */
export function writableDeviceOptions(devices: ScreenDevice[], analogOnly = false): Opt[] {
  const test = analogOnly ? isWritableAnalogPoint : isWritablePoint;
  const writable = devices.filter((d) => d.points.some((p) => test(d, p.tag)));
  return [{ value: '', label: '— selecionar —' }, ...writable.map((d) => ({ value: d.id, label: `${d.name} (${d.protocol.toUpperCase()})` }))];
}

/**
 * Pontos comandáveis SOMENTE do equipamento escolhido (mesma validação do envio
 * de comando). Nunca inclui pontos de outro device — mesmo com tags repetidas
 * entre devices do mesmo gateway (ex.: SETPOINT em dois equipamentos).
 */
export function writableTagOptions(devices: ScreenDevice[], deviceId: string, analogOnly = false): Opt[] {
  const dev = devices.find((d) => d.id === deviceId);
  const test = analogOnly ? isWritableAnalogPoint : isWritablePoint;
  const pts = (dev?.points ?? []).filter((p) => test(dev, p.tag));
  return [{ value: '', label: '— selecionar —' }, ...pts.map((p) => ({ value: p.tag, label: pointOptLabel(p) }))];
}

/** true quando o equipamento escolhido é BACnet (mostra campos exclusivos, ex.: prioridade). */
export function isBacnetDevice(devices: ScreenDevice[], deviceId: string): boolean {
  return devices.find((d) => d.id === deviceId)?.protocol === 'bacnet';
}

/**
 * Saneia a tag salva no widget contra o equipamento selecionado: retorna '' se
 * a tag não for um ponto comandável DESSE device (ex.: tag herdada de outra
 * controladora em telas salvas por versão antiga, ou device trocado sem limpar).
 * Evita que o <select> nativo "esconda" um valor inválido enquanto o widget
 * continua apontando para o ponto de outro equipamento.
 */
export function sanitizeCommandTag(
  devices: ScreenDevice[],
  deviceId: string,
  tag: string,
  analogOnly = false,
): string {
  if (!deviceId || !tag) return '';
  const dev = devices.find((d) => d.id === deviceId);
  const test = analogOnly ? isWritableAnalogPoint : isWritablePoint;
  return dev && dev.points.some((p) => p.tag === tag) && test(dev, tag) ? tag : '';
}

/**
 * true quando o equipamento selecionado tem pontos que NÃO aparecem no seletor
 * de comando (somente leitura, ex.: input register/discrete input Modbus, ou
 * não-analógicos no slider) — para a UI explicar em vez de sumir em silêncio.
 */
export function hasHiddenReadOnlyPoints(devices: ScreenDevice[], deviceId: string, analogOnly = false): boolean {
  const dev = devices.find((d) => d.id === deviceId);
  if (!dev) return false;
  const test = analogOnly ? isWritableAnalogPoint : isWritablePoint;
  return dev.points.some((p) => !test(dev, p.tag));
}
