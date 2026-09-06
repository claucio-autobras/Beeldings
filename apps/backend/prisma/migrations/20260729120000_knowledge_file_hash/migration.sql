-- Bloqueia importação duplicada do mesmo PDF na base de conhecimento.
ALTER TABLE "knowledge_docs" ADD COLUMN "file_hash" TEXT;

CREATE UNIQUE INDEX "knowledge_docs_file_hash_key" ON "knowledge_docs"("file_hash");
