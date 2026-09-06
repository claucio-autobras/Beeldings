-- Capa opcional do empreendimento exibida nos cards da landing do SCADA.
-- Os bytes permanecem no App Storage; esta coluna guarda somente a URL relativa.
ALTER TABLE "projects"
  ADD COLUMN "cover_image_url" TEXT;