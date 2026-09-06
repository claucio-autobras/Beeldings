import { type Alarm, mockAlarms } from '@/mocks/data/alarms.mock';

let store: Alarm[] = mockAlarms.map((a) => ({ ...a }));

export interface AlarmStats {
  total: number;
  pendingAck: number;
  activeCount: number;
  acknowledgedCount: number;
}

export const alarmsHandler = {
  getAll(tenantId?: string): Alarm[] {
    return tenantId ? store.filter((a) => a.tenantId === tenantId) : [...store];
  },

  acknowledge(alarmId: string, userId: string, note: string): Alarm {
    const idx = store.findIndex((a) => a.id === alarmId);
    if (idx === -1) throw new Error(`Alarme não encontrado: ${alarmId}`);

    const alarm = store[idx];
    if (alarm.status !== 'NORMAL') {
      throw new Error('Somente alarmes com status NORMAL podem ser reconhecidos.');
    }

    const trimmedNote = note.trim() || null;
    const updated: Alarm = {
      ...alarm,
      status: 'RECONHECIDO',
      acknowledgedBy: userId,
      acknowledgedByName: 'Usuário Demo',
      acknowledgedAt: new Date().toISOString(),
      note: trimmedNote,
      ackNote: trimmedNote ?? undefined,
    };
    store = store.map((a) => (a.id === alarmId ? updated : a));
    return updated;
  },

  getStats(tenantId?: string): AlarmStats {
    const alarms = tenantId ? store.filter((a) => a.tenantId === tenantId) : [...store];

    return {
      total: alarms.length,
      pendingAck: alarms.filter((a) => a.status === 'NORMAL').length,
      activeCount: alarms.filter((a) => a.status === 'ALARME').length,
      acknowledgedCount: alarms.filter((a) => a.status === 'RECONHECIDO').length,
    };
  },
};
