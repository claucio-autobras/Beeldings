-- Telas SCADA (sinópticos) persistidas no servidor.
-- Escopo: tenant obrigatório; site/projeto opcionais (a tela vive dentro do projeto).
-- O layout dos widgets e os ajustes de canvas são guardados como JSON opaco.

CREATE TABLE "scada_screens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT,
    "project_id" TEXT,
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "status" TEXT NOT NULL DEFAULT 'active',
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scada_screens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scada_screens_tenant_id_idx" ON "scada_screens"("tenant_id");
CREATE INDEX "scada_screens_project_id_idx" ON "scada_screens"("project_id");
CREATE INDEX "scada_screens_site_id_idx" ON "scada_screens"("site_id");

ALTER TABLE "scada_screens" ADD CONSTRAINT "scada_screens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scada_screens" ADD CONSTRAINT "scada_screens_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scada_screens" ADD CONSTRAINT "scada_screens_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
