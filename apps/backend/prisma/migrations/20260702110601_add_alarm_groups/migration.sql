-- DropIndex
DROP INDEX "knowledge_chunks_embedding_idx";

-- CreateTable
CREATE TABLE "alarm_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarm_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_group_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "alarm_rule_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alarm_groups_tenant_id_idx" ON "alarm_groups"("tenant_id");

-- CreateIndex
CREATE INDEX "alarm_groups_site_id_idx" ON "alarm_groups"("site_id");

-- CreateIndex
CREATE INDEX "alarm_group_members_alarm_rule_id_idx" ON "alarm_group_members"("alarm_rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "alarm_group_members_group_id_alarm_rule_id_key" ON "alarm_group_members"("group_id", "alarm_rule_id");

-- AddForeignKey
ALTER TABLE "alarm_groups" ADD CONSTRAINT "alarm_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_groups" ADD CONSTRAINT "alarm_groups_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_group_members" ADD CONSTRAINT "alarm_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "alarm_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_group_members" ADD CONSTRAINT "alarm_group_members_alarm_rule_id_fkey" FOREIGN KEY ("alarm_rule_id") REFERENCES "alarm_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
