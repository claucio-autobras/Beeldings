-- Marca quais projetos foram adicionados ao módulo SCADA.
-- Um projeto só aparece como card na landing do SCADA quando scada_enabled = true.
ALTER TABLE "projects" ADD COLUMN "scada_enabled" BOOLEAN NOT NULL DEFAULT false;
