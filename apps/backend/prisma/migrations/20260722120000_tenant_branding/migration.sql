-- Identidade visual do cliente (logo + cor de destaque) exibida na topbar.
ALTER TABLE "tenants" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "tenants" ADD COLUMN "accent_color" TEXT;
