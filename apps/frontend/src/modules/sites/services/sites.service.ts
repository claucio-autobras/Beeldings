import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api-client';

export interface SiteItem {
  id: string;
  name: string;
  tenantId: string;
  location?: string | null;
  responsibleName?: string | null;
  createdAt: string;
  _count?: { projects: number };
}

export interface CreateSiteDto {
  name: string;
  tenantId: string;
  location?: string;
  responsibleName?: string;
}

export interface UpdateSiteDto {
  name?: string;
  location?: string | null;
  responsibleName?: string | null;
}

export const getSites = (tenantId?: string): Promise<SiteItem[]> =>
  apiGet(`/sites${tenantId ? `?tenantId=${tenantId}` : ''}`);

export const createSite = (data: CreateSiteDto): Promise<SiteItem> =>
  apiPost('/sites', data);

export const updateSite = (id: string, data: UpdateSiteDto): Promise<SiteItem> =>
  apiPatch(`/sites/${id}`, data);

export const deleteSite = (id: string): Promise<void> =>
  apiDelete(`/sites/${id}`);
