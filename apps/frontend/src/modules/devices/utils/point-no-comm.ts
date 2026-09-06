/**
 * Decide se o selo de status de um ponto deve ser substituído pelo selo neutro
 * "Sem comunicação" (PointNoCommBadge) nas telas de detalhe MQTT/Modbus.
 *
 * Regra: só o estado "normal" é substituído. Um "Normal" verde com valor de
 * dias atrás passa a falsa impressão de saúde quando o equipamento está
 * offline; já os selos "alarm" (vermelho) e "fault" (âmbar) carregam
 * severidade operacional e são PRESERVADOS mesmo sem comunicação — ocultá-los
 * esconderia um alarme/falha conhecido do operador.
 *
 * `noCommunication` vem do hook compartilhado useDeviceNoCommunication (mesma
 * detecção do banner âmbar), que já respeita a janela de carência inicial e o
 * heartbeat ao vivo (statusIsLive) dos equipamentos MQTT que publicam só na
 * mudança de valor.
 */
export function showNoCommBadge(
  noCommunication: boolean,
  pointStatus: string | null | undefined,
): boolean {
  return noCommunication && String(pointStatus ?? '').toLowerCase() === 'normal';
}
