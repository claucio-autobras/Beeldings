// Endereço e contato técnico agora pertencem ao Site (localidade física) —
// as colunas address/technicalContact do Project são legado e não são mais
// aceitas na API de projetos.
export interface UpdateProjectDto {
  name?: string;
}
