-- Arquivos MIB (ASN.1) importados pelo admin para resolver OIDs proprietários.
-- Armazena os mapeamentos já parseados (oid→nome/descrição) em JSONB para
-- enriquecer a exibição na tela de descoberta SNMP.
CREATE TABLE "snmp_mibs" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "label"           TEXT        NOT NULL,
  "source_filename" TEXT,
  "entries"         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "snmp_mibs_pkey" PRIMARY KEY ("id")
);
