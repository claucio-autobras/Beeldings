/**
 * Payload de criação de uma tela SCADA.
 *
 * `widgets` e `settings` são JSON opaco para o backend — o frontend é dono do
 * schema dos widgets. A tela é escopada por tenant, site e projeto (gateway),
 * todos obrigatórios para novas telas.
 */
export interface CreateScadaScreenDto {
  name: string;
  description?: string;
  tenantId: string;
  siteId: string;
  projectId: string;
  width?: number;
  height?: number;
  widgets?: unknown[];
  settings?: Record<string, unknown>;
}
