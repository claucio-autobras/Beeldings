-- Reorganiza a hierarquia: Cliente -> Site -> Projeto -> Gateway -> Ponto
-- Antes: Tenant -> Project -> Site -> Gateway
-- Depois: Tenant -> Site -> Project -> Gateway
-- Banco recriado (ambiente de teste): tabelas project/site/gateway estão vazias.

-- DropForeignKey
ALTER TABLE "sites" DROP CONSTRAINT "sites_project_id_fkey";
ALTER TABLE "gateways" DROP CONSTRAINT "gateways_site_id_fkey";

-- Site deixa de pertencer a Project; passa a pertencer direto ao Tenant
ALTER TABLE "sites" DROP COLUMN "project_id";

-- Project passa a pertencer a um Site
ALTER TABLE "projects" ADD COLUMN "site_id" TEXT NOT NULL;

-- Gateway passa a pertencer a um Project (um por projeto)
ALTER TABLE "gateways" DROP COLUMN "site_id";
ALTER TABLE "gateways" ADD COLUMN "project_id" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "gateways_project_id_key" ON "gateways"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
