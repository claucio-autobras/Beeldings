/**
 * Perfil BASE para NVR/DVR (gravadores de vídeo em rede).
 *
 * Cobre métricas escalares universais (MIB-II / HOST-RESOURCES-MIB / UCD-SNMP)
 * e declara os prefixos de tabela de disco e canal de gravação como campos sem
 * OID universal — perfis de fabricante (priority=10) fornecem os tableOidPrefix
 * proprietários das respectivas MIBs enterprise.
 *
 * Scalars:
 *   - uptime   → sysUpTime (TimeTicks, scale 0.01 → s)
 *   - cpu      → hrProcessorLoad (HOST-RESOURCES-MIB, primeira CPU)
 *   - memory   → UCD memAvailReal (kB disponível)
 *   - temperature → UCD lm-sensors (mili-°C → scale 0.001 → °C)
 *
 * Tabelas (sem OID universal — herdadas pelos perfis de fabricante):
 *   - disk_status    → estado do disco (0=ausente, 1=normal, 2=erro)
 *   - disk_capacity  → capacidade total (GB)
 *   - disk_used      → uso (GB)
 *   - channel_status → estado do canal de gravação (0=offline, 1=idle, 2=gravando)
 *
 * priority=0: sempre fundido primeiro; perfis de fabricante (priority=10)
 * sobrescrevem campo a campo.
 */

import type { DeviceProfile } from '../types';

export const BASE_NVR_PROFILE: DeviceProfile = {
  id: 'base-nvr',
  label: 'NVR/DVR (MIB-II padrão)',
  deviceTypes: ['NVR'],
  priority: 0,
  mappings: [
    // ── MIB-II sysUpTime ────────────────────────────────────────────────────
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── HOST-RESOURCES-MIB hrProcessorLoad (primeira CPU) ───────────────────
    // Fallback genérico: usado quando nenhum perfil vendor cobre cpu.
    // Perfis vendor (Hikvision: .1.7.0 / Dahua: 2.1.3.1.1.1) sobrescrevem.
    { metricKey: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1 },

    // ── UCD-SNMP memAvailReal (kB disponível) ────────────────────────────────
    // Métrica canônica de RAM para NVR: todos os perfis vendor expõem 'memory'
    // (uso % ou kB disponível). A métrica 'ram_total' (RAM total em bytes) é
    // exclusiva de câmeras Hikvision e não tem OID universal nos NVRs.
    { metricKey: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1 },

    // ── UCD lm-sensors temperatura (mili-°C → scale 0.001 → °C) ─────────────
    // Fallback genérico; vendor profiles fornecem OID próprio quando disponível.
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001 },

    // ── Tabelas de disco e canal: sem OID universal ──────────────────────────
    // tableOidPrefix é preenchido pelos perfis de fabricante (Hikvision/Dahua).
    // Sem o prefix o motor ignora a métrica — capability map fica UNSUPPORTED.
    { metricKey: 'disk_status' },
    { metricKey: 'disk_capacity' },
    { metricKey: 'disk_used' },
    // disk_free: só Hikvision usa (hikHddFreeSpace col 3).
    // O driver lê esta métrica como dependência implícita para derivar
    // disk_used = disk_capacity - disk_free no perfil hikvision-nvr.
    { metricKey: 'disk_free' },
    { metricKey: 'channel_status' },
  ],
};
