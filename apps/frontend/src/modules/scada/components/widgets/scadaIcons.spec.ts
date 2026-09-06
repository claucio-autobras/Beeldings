import { DEVICE_COUNTER_DEFAULT_ICON } from '../../types/scada.types';
import { getDeviceCounterIcon, SCADA_ICONS } from './scadaIcons';

describe('device counter icon resolution', () => {
  it('registers the legacy device drawing in the shared icon library', () => {
    expect(SCADA_ICONS[DEVICE_COUNTER_DEFAULT_ICON]).toBeDefined();
    expect(getDeviceCounterIcon(DEVICE_COUNTER_DEFAULT_ICON)).toBe(SCADA_ICONS[DEVICE_COUNTER_DEFAULT_ICON].Icon);
  });

  it('falls back to the legacy drawing for old or unknown screen JSON', () => {
    const fallback = SCADA_ICONS[DEVICE_COUNTER_DEFAULT_ICON].Icon;

    expect(getDeviceCounterIcon()).toBe(fallback);
    expect(getDeviceCounterIcon('icon-that-no-longer-exists')).toBe(fallback);
  });

  it('resolves icons from both navigation and SCADA entries', () => {
    expect(getDeviceCounterIcon('server')).not.toBe(SCADA_ICONS[DEVICE_COUNTER_DEFAULT_ICON].Icon);
    expect(getDeviceCounterIcon('camera')).toBe(SCADA_ICONS.camera.Icon);
  });
});