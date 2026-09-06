-- Metadados do turno (fontes RAG, casos similares, flag de erro) para o chat
-- assíncrono: o resultado precisa ser durável para polling em qualquer instância.
ALTER TABLE "ai_messages" ADD COLUMN "data" JSONB;
