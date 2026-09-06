export const HIVE_ALARM_FOCUS_THRESHOLD = 3;
export const HIVE_OFFLINE_FOCUS_RATIO = 0.2;

export type HiveFocus = 'alarms' | 'offline' | 'stable';

interface HiveFocusInput {
  activeAlarms: number;
  offlineDevices: number;
  totalDevices: number;
}

/**
 * Chooses the operational condition that deserves the central KPI cell.
 * Alarm volume has precedence over availability so an urgent condition is
 * never visually hidden by the offline percentage.
 */
export function resolveHiveFocus({
  activeAlarms,
  offlineDevices,
  totalDevices,
}: HiveFocusInput): HiveFocus {
  if (activeAlarms >= HIVE_ALARM_FOCUS_THRESHOLD) return 'alarms';
  if (totalDevices > 0 && offlineDevices / totalDevices >= HIVE_OFFLINE_FOCUS_RATIO) {
    return 'offline';
  }
  return 'stable';
}