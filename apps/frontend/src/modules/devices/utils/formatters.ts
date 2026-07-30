export function formatLastCommunication(isoDate: string | null | undefined): string {
  // Sem nenhuma comunicação real registrada — nunca inventamos uma data.
  if (!isoDate) return 'sem dados';
  const diff = Date.now() - new Date(isoDate).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'agora mesmo';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `há ${mins} minuto${mins > 1 ? 's' : ''}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours} hora${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

export function formatRegisterType(type: string): string {
  const map: Record<string, string> = {
    holding: 'Holding Register',
    input: 'Input Register',
    coil: 'Coil',
    discrete: 'Discrete Input',
  };
  return map[type] ?? type;
}

export function formatDataType(type: string): string {
  const map: Record<string, string> = {
    uint16: 'UInt16',
    int16: 'Int16',
    float32: 'Float32',
    boolean: 'Boolean',
  };
  return map[type] ?? type;
}

export function formatPointValue(value: number | string | boolean, unit: string): string {
  if (typeof value === 'boolean') return value ? 'Ligado' : 'Desligado';
  if (typeof value === 'string') return value;
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}
