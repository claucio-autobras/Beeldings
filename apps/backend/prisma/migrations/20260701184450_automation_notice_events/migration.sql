-- CreateEnum
CREATE TYPE "AlarmEventKind" AS ENUM ('ALARM', 'AUTOMATION_NOTICE');

-- AlterTable
ALTER TABLE "alarm_events" ADD COLUMN     "kind" "AlarmEventKind" NOT NULL DEFAULT 'ALARM',
ADD COLUMN     "message" TEXT,
ADD COLUMN     "severity" "AlarmSeverity",
ADD COLUMN     "source_name" TEXT,
ALTER COLUMN "alarm_rule_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "alarm_events_kind_idx" ON "alarm_events"("kind");
