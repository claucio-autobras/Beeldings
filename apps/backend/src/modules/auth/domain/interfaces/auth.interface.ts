import type { UserPreferences } from './user-preferences.interface.js';

export enum UserRole {
  ADMIN = 'ADMIN',
  CCO = 'CCO',
  SUPERVISOR = 'SUPERVISOR',
  CLIENTE = 'CLIENTE',
  VISUALIZADOR = 'VISUALIZADOR',
}

export interface JwtPayload {
  sub: string;       // user id (Prisma)
  email: string;
  role: UserRole;
  tenantId: string | null;
  sessionVersion?: number;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  supabaseId: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  createdAt?: string;
  /** Preferências pessoais (tema, idioma, sino) — presentes no login/perfil. */
  preferences?: UserPreferences;
}

export interface LoginResult {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface TwoFactorRequiredResult {
  requiresTwoFactor: true;
  challengeId: string;
  expiresInSeconds: number;
  emailMasked: string;
}

export type LoginOutcome = LoginResult | TwoFactorRequiredResult;
