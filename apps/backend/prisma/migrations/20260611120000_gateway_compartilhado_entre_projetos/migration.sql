-- Compartilhar gateway entre projetos: relação Projeto↔Gateway passa de 1:1
-- (gateways.project_id @unique) para 1 gateway → N projetos (projects.gateway_id).

-- 1. Nova coluna de vínculo no projeto (nullable durante a migração)
ALTER TABLE "projects" ADD COLUMN "gateway_id" TEXT;

-- 2. Backfill: preserva o vínculo 1:1 existente (gateways.project_id -> projects.gateway_id)
UPDATE "projects" p
SET "gateway_id" = g."id"
FROM "gateways" g
WHERE g."project_id" = p."id";

-- 3. Remove o vínculo antigo no gateway (FK + unique + coluna)
ALTER TABLE "gateways" DROP CONSTRAINT "gateways_project_id_fkey";
DROP INDEX "gateways_project_id_key";
ALTER TABLE "gateways" DROP COLUMN "project_id";

-- 4. Índice + FK do novo vínculo (SetNull para não quebrar projetos se o gateway sair)
CREATE INDEX "projects_gateway_id_idx" ON "projects"("gateway_id");
ALTER TABLE "projects" ADD CONSTRAINT "projects_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;
