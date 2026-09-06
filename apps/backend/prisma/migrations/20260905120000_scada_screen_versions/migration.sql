CREATE TABLE "scada_screen_versions" (
    "id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scada_screen_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scada_screen_versions_screen_id_created_at_idx"
ON "scada_screen_versions"("screen_id", "created_at" DESC);

CREATE INDEX "scada_screen_versions_tenant_id_idx"
ON "scada_screen_versions"("tenant_id");

ALTER TABLE "scada_screen_versions"
ADD CONSTRAINT "scada_screen_versions_screen_id_fkey"
FOREIGN KEY ("screen_id") REFERENCES "scada_screens"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scada_screen_versions"
ADD CONSTRAINT "scada_screen_versions_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;