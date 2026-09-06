export interface CreateSiteDto {
  name: string;
  tenantId: string;
  /** Endereço/localização física do site (opcional). */
  location?: string | null;
  /** Contato técnico/responsável pelo site (opcional). */
  responsibleName?: string | null;
}
