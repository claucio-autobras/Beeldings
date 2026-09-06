-- Restaura o módulo de IA (Chat IA + base de conhecimento RAG) que foi removido
-- por um rollback de checkpoint. Migração ADITIVA — só cria tipos, tabelas e
-- índices novos; não altera dados existentes.

-- ─── Chat IA: conversas e mensagens ──────────────────────────────────────────
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_user_id_idx" ON "ai_conversations"("user_id");
CREATE INDEX "ai_messages_conversation_id_idx" ON "ai_messages"("conversation_id");

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Rate limit do /ai/chat ──────────────────────────────────────────────────
CREATE TABLE "ai_rate_limit_hits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_rate_limit_hits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_rate_limit_hits_key_created_at_idx" ON "ai_rate_limit_hits"("key", "created_at");

-- ─── Base de conhecimento (RAG) ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "KnowledgeType" AS ENUM ('MANUAL', 'HOWTO', 'PLAYBOOK');
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'APPROVED');

CREATE TABLE "knowledge_docs" (
    "id" TEXT NOT NULL,
    "type" "KnowledgeType" NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "equipment_type" TEXT,
    "equipment_model" TEXT,
    "source" TEXT,
    "anonymized" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_docs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_docs_status_idx" ON "knowledge_docs"("status");
CREATE INDEX "knowledge_docs_equipment_type_idx" ON "knowledge_docs"("equipment_type");
CREATE INDEX "knowledge_chunks_doc_id_idx" ON "knowledge_chunks"("doc_id");

ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "knowledge_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índice HNSW para busca por similaridade de cosseno nos embeddings.
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
