import { mockRequest } from './api-mock';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
const USER_KEY = 'bluebee_user';

/**
 * Trata resposta de erro da API. Caso especial: 403 com code=TENANT_INACTIVE
 * significa que o cliente (tenant) do usuário foi inativado — a sessão local é
 * encerrada na hora e o usuário volta ao login com a mensagem amigável.
 */
/** Erro de API com o `code` estruturado do backend (quando enviado). */
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function throwApiError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
  if (res.status === 403 && body.code === 'TENANT_INACTIVE' && typeof window !== 'undefined') {
    localStorage.removeItem(USER_KEY);
    // Expira o cookie de sessão HttpOnly no servidor (fire-and-forget).
    void fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    window.location.href = '/login?reason=tenant-inactive';
  }
  throw new ApiError(body.message ?? `HTTP ${res.status}`, body.code);
}

/**
 * Headers padrão das chamadas à API. A autenticação NÃO vai mais em header:
 * o browser envia automaticamente o cookie de sessão HttpOnly (`credentials`).
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  if (USE_MOCK) return mockRequest<T>('GET', path);
  const res = await fetch(`${API_URL}${path}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    await throwApiError(res);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) return mockRequest<T>('POST', path, body);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    await throwApiError(res);
  }
  // Respostas sem corpo (204 No Content ou body vazio) não passam por
  // res.json() — senão o parse falha mesmo com a ação aplicada no backend.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) return mockRequest<T>('PATCH', path, body);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    await throwApiError(res);
  }
  return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) return mockRequest<T>('PUT', path, body);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    await throwApiError(res);
  }
  return res.json() as Promise<T>;
}

/** Header exigido pelo backend nas exclusões críticas (token de confirmação de senha). */
export function sensitiveActionHeaders(confirmationToken: string): Record<string, string> {
  return { 'X-Sensitive-Action-Token': confirmationToken };
}

export async function apiDelete(path: string, options?: { headers?: Record<string, string> }): Promise<void> {
  if (USE_MOCK) {
    await mockRequest<void>('DELETE', path);
    return;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: authHeaders(options?.headers),
    credentials: 'include',
  });
  if (!res.ok) {
    await throwApiError(res);
  }
}
