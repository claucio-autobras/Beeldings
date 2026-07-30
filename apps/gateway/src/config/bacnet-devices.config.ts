import { BACnetDeviceConfig } from '../bacnet/domain/interfaces/bacnet-config.interface';

/**
 * Dispositivos BACnet monitorados por este gateway.
 *
 * FONTE DA VERDADE: a lista real de dispositivos e pontos vem dinamicamente do
 * backend via MQTT (tópico .../config), derivada dos pontos cadastrados no banco
 * — ver BacnetPollingService.handleConfigMessage. O `id` e o `name` de cada
 * device vêm de `deviceId`/`name` do backend, nunca fixos aqui.
 *
 * Por isso esta lista é INTENCIONALMENTE VAZIA: não há bootstrap estático com
 * nome/IP hardcoded. Enquanto a config dinâmica não chega, o gateway não poll-a
 * nada (evita logs presos em um device fictício como "mpc46d-01").
 */
export const bacnetDevices: BACnetDeviceConfig[] = [];
