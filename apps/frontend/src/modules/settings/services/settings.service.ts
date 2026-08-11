import { apiGet, apiPatch } from '@/lib/api-client';
import type { UserRole } from '@/hooks/useCurrentUser';
// Re-export canonical tenant types/functions so page imports stay unchanged.
export type {
  TenantItem,
  InitialRecipientDto,
  CreateTenantDto,
} from '@/modules/tenants/services/tenants.service';
export { createTenant } from '@/modules/tenants/services/tenants.service';

// ─── Tenant (cliente) ─────────────────────────────────────────────────────────

export interface UpdateTenantDto {
  name?: string;
  slug?: string;
}

export async function getTenants(): Promise<import('@/modules/tenants/services/tenants.service').TenantItem[]> {
  return apiGet('/tenants');
}

export async function updateTenant(id: string, data: UpdateTenantDto): Promise<import('@/modules/tenants/services/tenants.service').TenantItem> {
  return apiPatch(`/tenants/${id}`, data);
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
