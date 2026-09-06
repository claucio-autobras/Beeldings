export interface LoginDto {
  email: string;
  password: string;
  /** Token do widget Cloudflare Turnstile (obrigatório quando habilitado no servidor). */
  turnstileToken?: string;
}
