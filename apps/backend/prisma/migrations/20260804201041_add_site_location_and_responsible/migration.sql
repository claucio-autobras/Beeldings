-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "location" TEXT,
ADD COLUMN     "responsible_name" TEXT;

-- DataMigration: promote address/technicalContact from projects to their parent site.
-- When multiple projects in a site have conflicting values, the oldest project wins.
UPDATE sites s
SET
  location = (
    SELECT p.address FROM projects p
    WHERE p.site_id = s.id AND p.address IS NOT NULL AND p.address <> ''
    ORDER BY p.created_at ASC LIMIT 1
  ),
  responsible_name = (
    SELECT p.technical_contact FROM projects p
    WHERE p.site_id = s.id AND p.technical_contact IS NOT NULL AND p.technical_contact <> ''
    ORDER BY p.created_at ASC LIMIT 1
  )
WHERE EXISTS (
  SELECT 1 FROM projects p
  WHERE p.site_id = s.id
    AND (
      (p.address IS NOT NULL AND p.address <> '')
      OR (p.technical_contact IS NOT NULL AND p.technical_contact <> '')
    )
);
