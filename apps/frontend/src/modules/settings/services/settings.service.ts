import { apiGet, apiPatch } from '@/lib/api-client';
import type { UserRole } from '@/hooks/useCurrentUser';

// ─── Tenant (cliente) ─────────────────────────────────────────────────────────

export interface TenantItem {
  id: string;
  name: string;
  slug: string;
  siteCount?: number;
  deviceCount?: number;
  createdAt: string;
}

export interface UpdateTenantDto {
  name?: string;
  slug?: string;
}

export async function getTenants(): Promise<TenantItem[]> {
  return apiGet<TenantItem[]>('/tenants');
}

export async function updateTenant(id: string, data: UpdateTenantDto): Promise<TenantItem> {
  return apiPatch<TenantItem>(`/tenants/${id}`, data);
}

// ─── Perfil do usuário ─────────────────────────────────────────────────────────

export interface ProfileResponse {
  id: string;
  supabaseId?: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export async function getProfile(): Promise<ProfileResponse> {
  return apiGet<ProfileResponse>('/auth/profile');
}

export async function updateProfile(data: { name: string; email: string }): Promise<ProfileResponse> {
  return apiPatch<ProfileResponse>('/account/profile', data);
}

export async function changePassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean }> {
  return apiPatch<{ success: boolean }>('/account/password', data);
}
