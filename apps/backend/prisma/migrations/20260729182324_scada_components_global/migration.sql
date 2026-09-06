-- CreateTable
CREATE TABLE "scada_components" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scada_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scada_components_tenant_id_idx" ON "scada_components"("tenant_id");

-- AddForeignKey
ALTER TABLE "scada_components" ADD CONSTRAINT "scada_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
