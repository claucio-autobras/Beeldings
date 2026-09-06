-- Marca a tela inicial ("home") de cada projeto SCADA.
-- A regra "apenas uma tela home por projeto" é garantida na camada de aplicação.
ALTER TABLE "scada_screens" ADD COLUMN "is_home" BOOLEAN NOT NULL DEFAULT false;
