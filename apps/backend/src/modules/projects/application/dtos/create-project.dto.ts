export interface CreateProjectDto {
  name: string;
  address?: string;
  technicalContact?: string;
  siteId: string;
  tenantId: string;
  /**
   * Quando informado, o projeto é vinculado a um gateway já existente do mesmo
   * cliente (de qualquer site) em vez de provisionar um novo. Permite compartilhar
   * um gateway físico entre vários projetos/sites — ex.: torres que enviam os
   * equipamentos a um rack central com um único gateway.
   */
  gatewayId?: string;
}
