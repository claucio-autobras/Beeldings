import { apiGet, apiPost, apiDelete } from '@/lib/api-client';

export interface SiteItem {
  id: string;
  name: string;
  tenantId: string;
  createdAt: string;
  _count?: { projects: number };
}

export interface CreateSiteDto {
  name: string;
  tenantId: string;
}

export const getSites = (tenantId?: string): Promise<SiteItem[]> =>
  apiGet(`/sites${tenantId ? `?tenantId=${tenantId}` : ''}`);

export const createSite = (data: CreateSiteDto): Promise<SiteItem> =>
  apiPost('/sites', data);

export const deleteSite = (id: string): Promise<void> =>
  apiDelete(`/sites/${id}`);
