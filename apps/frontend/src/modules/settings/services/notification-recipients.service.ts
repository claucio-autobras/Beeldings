import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecipientSite {
  id: string;
  name: string;
}

export interface NotificationRecipient {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  alarms: boolean;
  insights: boolean;
  allSites: boolean;
  active: boolean;
  sites: RecipientSite[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecipientDto {
  tenantId?: string;
  name: string;
  email?: string;
  phone?: string;
  emailEnabled?: boolean;
  whatsappEnabled?: boolean;
  alarms?: boolean;
  insights?: boolean;
  allSites?: boolean;
  siteIds?: string[];
  active?: boolean;
}

export interface UpdateRecipientDto {
  name?: string;
  email?: string;
  phone?: string;
  emailEnabled?: boolean;
  whatsappEnabled?: boolean;
  alarms?: boolean;
  insights?: boolean;
  allSites?: boolean;
  siteIds?: string[];
  active?: boolean;
}

export interface ResolvedRecipient {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function getRecipients(tenantId?: string): Promise<NotificationRecipient[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return apiGet<NotificationRecipient[]>(`/notification-recipients${qs}`);
}

export async function createRecipient(dto: CreateRecipientDto): Promise<NotificationRecipient> {
  return apiPost<NotificationRecipient>('/notification-recipients', dto);
}

export async function updateRecipient(
  id: string,
  dto: UpdateRecipientDto,
): Promise<NotificationRecipient> {
  return apiPatch<NotificationRecipient>(`/notification-recipients/${id}`, dto);
}

export async function deleteRecipient(id: string): Promise<void> {
  return apiDelete(`/notification-recipients/${id}`);
}

export async function resolveRecipients(params: {
  tenantId: string;
  category: 'alarms' | 'insights';
  channel?: 'email' | 'whatsapp';
  siteId?: string;
}): Promise<ResolvedRecipient[]> {
  const qs = new URLSearchParams({ tenantId: params.tenantId, category: params.category });
  if (params.channel) qs.set('channel', params.channel);
  if (params.siteId) qs.set('siteId', params.siteId);
  return apiGet<ResolvedRecipient[]>(`/notification-recipients/resolve?${qs.toString()}`);
}
