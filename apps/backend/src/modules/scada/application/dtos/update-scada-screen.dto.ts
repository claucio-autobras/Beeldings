/**
 * Payload de atualização de uma tela SCADA. Todos os campos são opcionais —
 * o editor normalmente salva apenas `widgets`/`settings`, mas nome, dimensões,
 * escopo e status também podem ser ajustados.
 */
export interface UpdateScadaScreenDto {
  name?: string;
  description?: string;
  siteId?: string | null;
  projectId?: string | null;
  width?: number;
  height?: number;
  status?: string;
  widgets?: unknown[];
  settings?: Record<string, unknown>;
}
