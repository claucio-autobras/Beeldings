-- Cópia local indexada dos chamados da Infraspeak (base do analista de IA).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "infraspeak_tickets" (
    "id" TEXT NOT NULL,
    "failure_id" INTEGER NOT NULL,
    "uuid" TEXT,
    "state" TEXT,
    "state_description" TEXT,
    "priority" INTEGER,
    "priority_text" TEXT,
    "problem_id" INTEGER,
    "problem_name" TEXT,
    "client_name" TEXT,
    "local_id" INTEGER,
    "local_name" TEXT,
    "description" TEXT,
    "observations" TEXT,
    "report_date" TEXT,
    "completed_date" TEXT,
    "api_updated_at" TEXT,
    "solved" BOOLEAN,
    "confirmed" BOOLEAN,
    "has_resolution" BOOLEAN NOT NULL DEFAULT false,
    "composed_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "infraspeak_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "infraspeak_tickets_failure_id_key" ON "infraspeak_tickets"("failure_id");
CREATE INDEX "infraspeak_tickets_problem_id_idx" ON "infraspeak_tickets"("problem_id");
CREATE INDEX "infraspeak_tickets_local_id_idx" ON "infraspeak_tickets"("local_id");
CREATE INDEX "infraspeak_tickets_state_idx" ON "infraspeak_tickets"("state");
CREATE INDEX "infraspeak_tickets_embedding_idx" ON "infraspeak_tickets" USING hnsw ("embedding" vector_cosine_ops);
