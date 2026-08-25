-- Evita que vários cliques em "reenviar código" emitam códigos concorrentes.
ALTER TABLE "auth_challenges" ADD COLUMN "last_sent_at" TIMESTAMP(3);