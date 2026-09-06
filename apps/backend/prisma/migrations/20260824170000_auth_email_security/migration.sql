-- Recuperação de senha e verificação de login por e-mail.
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "AuthChallengeType" AS ENUM ('PASSWORD_RESET', 'LOGIN_2FA');

CREATE TABLE "auth_challenges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "AuthChallengeType" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_challenges_user_id_type_expires_at_idx"
  ON "auth_challenges"("user_id", "type", "expires_at");

ALTER TABLE "auth_challenges"
  ADD CONSTRAINT "auth_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;