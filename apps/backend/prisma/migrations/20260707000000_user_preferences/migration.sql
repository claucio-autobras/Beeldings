-- Preferências pessoais do usuário (tema, idioma, notificações do sino)
ALTER TABLE "users" ADD COLUMN "preferences" JSONB;
