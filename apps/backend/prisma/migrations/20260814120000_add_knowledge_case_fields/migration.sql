-- Casos técnicos na base de conhecimento (método de diagnóstico Bluebee).
-- Migração ADITIVA: novo valor de enum + colunas opcionais em knowledge_docs.
-- Documentos existentes (MANUAL/HOWTO/PLAYBOOK) permanecem intactos.

-- Novo tipo de documento: caso técnico estruturado.
ALTER TYPE "KnowledgeType" ADD VALUE IF NOT EXISTS 'CASE';

-- Classe de conhecimento (ordem de confiança do método de diagnóstico).
CREATE TYPE "KnowledgeClass" AS ENUM ('FIELD_VALIDATED', 'DOCUMENTED', 'DERIVED', 'SYNTHETIC');

-- Campos estruturados de caso (null para documentos não-caso).
ALTER TABLE "knowledge_docs"
  ADD COLUMN "case_id" TEXT,
  ADD COLUMN "knowledge_class" "KnowledgeClass",
  ADD COLUMN "case_severity" TEXT,
  ADD COLUMN "protocol" TEXT,
  ADD COLUMN "subsystem" TEXT,
  ADD COLUMN "vendor_scope" TEXT,
  ADD COLUMN "symptom" TEXT,
  ADD COLUMN "evidence_strength" TEXT,
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Dedupe da importação seed por case_id (BB-BMS-XXXX).
CREATE UNIQUE INDEX "knowledge_docs_case_id_key" ON "knowledge_docs"("case_id");
