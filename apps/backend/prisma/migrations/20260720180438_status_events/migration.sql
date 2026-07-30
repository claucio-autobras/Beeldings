-- CreateTable
CREATE TABLE "status_events" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_events_entity_id_at_idx" ON "status_events"("entity_id", "at");

-- CreateIndex
CREATE INDEX "status_events_tenant_id_at_idx" ON "status_events"("tenant_id", "at");
