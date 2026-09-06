import {
  HIVE_ALARM_FOCUS_THRESHOLD,
  HIVE_OFFLINE_FOCUS_RATIO,
  resolveHiveFocus,
} from './dashboardHiveFocus';

describe('dashboard hive focus', () => {
  it('prioritizes alarms at the selected threshold', () => {
    expect(resolveHiveFocus({ activeAlarms: HIVE_ALARM_FOCUS_THRESHOLD, offlineDevices: 0, totalDevices: 10 }))
      .toBe('alarms');
  });

  it('uses offline devices when the ratio reaches twenty percent', () => {
    expect(resolveHiveFocus({ activeAlarms: 2, offlineDevices: 2, totalDevices: 10 }))
      .toBe('offline');
  });

  it('returns stable below both alert thresholds', () => {
    expect(resolveHiveFocus({ activeAlarms: 2, offlineDevices: 1, totalDevices: 10 }))
      .toBe('stable');
  });

  it('does not treat an empty device scope as offline', () => {
    expect(resolveHiveFocus({ activeAlarms: 0, offlineDevices: 0, totalDevices: 0 }))
      .toBe('stable');
    expect(HIVE_OFFLINE_FOCUS_RATIO).toBe(0.2);
  });
});