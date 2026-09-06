export interface SystemStatus {
  id: string;
  name: string;
  status: 'normal' | 'atencao' | 'falha';
  lastCheck: string;
}

const now = new Date('2026-06-01T10:00:00Z').getTime();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const mockSystemStatuses: SystemStatus[] = [
  { id: 'hvac',       name: 'Sistema HVAC',           status: 'normal',  lastCheck: minsAgo(2)  },
  { id: 'hidraulico', name: 'Sistema Hidráulico',      status: 'atencao', lastCheck: minsAgo(8)  },
  { id: 'eletrico',   name: 'Sistema Elétrico',        status: 'normal',  lastCheck: minsAgo(1)  },
  { id: 'incendio',   name: 'Sistema de Incêndio',     status: 'normal',  lastCheck: minsAgo(3)  },
  { id: 'iluminacao', name: 'Iluminação',               status: 'normal',  lastCheck: minsAgo(5)  },
  { id: 'geradores',  name: 'Geradores',                status: 'atencao', lastCheck: minsAgo(45) },
  { id: 'torres',     name: 'Torres de Resfriamento',   status: 'normal',  lastCheck: minsAgo(4)  },
  { id: 'elevadores', name: 'Elevadores',               status: 'normal',  lastCheck: minsAgo(6)  },
];

export const mockClientStats = {
  energyKwh: 1056,
  energyDeltaPct: 6.5,
  avgTemperature: 23.6,
  avgHumidity: 54,
  totalSystems: 8,
  systemsWithIssues: 2,
};
