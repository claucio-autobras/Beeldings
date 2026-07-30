/**
 * Rótulos pt-BR para os valores brutos da Infraspeak (estado e prioridade).
 * Valores não mapeados caem no valor bruto — nunca escondemos um estado novo.
 */

export const STATE_LABELS: Record<string, string> = {
  WAITING_APPROVAL: 'Aguardando aprovação',
  APPROVED: 'Aprovado',
  IN_PROGRESS: 'Em andamento',
  STARTED: 'Iniciado',
  PAUSED: 'Pausado',
  COMPLETED: 'Concluído',
  CLOSED: 'Fechado',
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

/** Opções de filtro de estado (JQL `s_state`, valor exato da Infraspeak). */
export const STATE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'WAITING_APPROVAL', label: 'Aguardando aprovação' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'PAUSED', label: 'Pausado' },
  { value: 'COMPLETED', label: 'Concluído' },
  { value: 'CLOSED', label: 'Fechado' },
];

/** Opções de filtro de prioridade (JQL `s_priority`, valor numérico). */
export const PRIORITY_FILTER_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Baixa' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Alta' },
];
