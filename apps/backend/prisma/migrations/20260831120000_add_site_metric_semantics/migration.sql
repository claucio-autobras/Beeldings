ALTER TABLE "device_points"
  ADD COLUMN "site_metric" TEXT,
  ADD COLUMN "site_metric_mode" TEXT;

CREATE INDEX "device_points_site_metric_idx" ON "device_points"("site_metric");