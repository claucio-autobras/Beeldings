import { apiGet, apiPatch, apiPost, API_URL } from '@/lib/api-client';

export interface TenantItem {
  id: string;
  name: string;
  slug: string;
  /** Cliente ativo/inativo (inativo = acesso bloqueado, notificações silenciadas). */
  active: boolean;
  /** Identidade visual (topbar): logo (URL relativa do backend) e cor de destaque. */
  logoUrl?: string | null;
  accentColor?: string | null;
  siteCount: number;
  deviceCount: number;
  createdAt: string;
}

export interface TenantBrandingDto {
  /** Novo nome do cliente (trim, não vazio); omitido não altera. Slug nunca muda. */
  name?: string;
  /** data URL base64 para trocar o logo; null remove; omitido não altera. */
  logoDataUrl?: string | null;
  /** '#rrggbb' para definir; null remove; omitido não altera. */
  accentColor?: string | null;
}

/** Resolve a URL do logo (relativa ao backend) para uma URL absoluta. */
export function resolveTenantLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (/^(https?:)?\/\//.test(logoUrl) || logoUrl.startsWith('data:')) return logoUrl;
  return `${API_URL}${logoUrl}`;
}

export async function updateTenantBranding(
  id: string,
  dto: TenantBrandingDto,
): Promise<{ id: string; name: string; logoUrl: string | null; accentColor: string | null }> {
  return apiPatch(`/tenants/${id}/branding`, dto);
}

export interface CreateTenantDto {
  name: string;
  slug: string;
}

export async function getTenants(): Promise<TenantItem[]> {
  return apiGet<TenantItem[]>('/tenants');
}

export async function createTenant(data: CreateTenantDto): Promise<TenantItem> {
  return apiPost<TenantItem>('/tenants', data);
}
