import { EmqxProvisioningService } from './emqx-provisioning.service.js';
import type { ConfigService } from '@nestjs/config';

/**
 * Limpeza de retained messages no de-provisionamento do gateway.
 * Garante que os tópicos status/health/config são removidos via API do
 * retainer e que falhas do EMQX nunca derrubam a exclusão (best-effort).
 */
describe('EmqxProvisioningService — retained cleanup', () => {
  const API = 'http://emqx.test/api/v5';
  let service: EmqxProvisioningService;
  let fetchMock: jest.Mock;

  const makeConfig = (apiUrl: string | undefined): ConfigService =>
    ({
      get: (key: string, def?: string) => {
        if (key === 'EMQX_API_URL') return apiUrl;
        return def ?? '';
      },
    }) as unknown as ConfigService;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new EmqxProvisioningService(makeConfig(API));
  });

  it('remove as retained de status, health e config do gateway', async () => {
    await service.purgeRetainedMessages('gw-1', 'tenant-a');

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(3);
    for (const sub of ['status', 'health', 'config']) {
      const topic = encodeURIComponent(`bluebee/tenant-a/gateway/gw-1/${sub}`);
      expect(urls).toContain(`${API}/mqtt/retainer/message/${topic}`);
    }
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('DELETE');
    }
  });

  it('404 (sem retained / retainer desabilitado) não é erro', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    await expect(service.purgeRetainedMessages('gw-1', 't')).resolves.toBeUndefined();
  });

  it('erro de rede não lança (best-effort)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.purgeRetainedMessages('gw-1', 't')).resolves.toBeUndefined();
  });

  it('sem EMQX_API_URL não faz nenhuma chamada', async () => {
    const off = new EmqxProvisioningService(makeConfig(undefined));
    await off.purgeRetainedMessages('gw-1', 't');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deprovisionGateway limpa usuário, ACL, usuário de sensores e retained', async () => {
    await service.deprovisionGateway('gw-1', 'tenant-a');

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain(`${API}/authentication/password_based:built_in_database/users/gw-1`);
    expect(urls).toContain(`${API}/authorization/sources/built_in_database/rules/users/gw-1`);
    expect(urls).toContain(
      `${API}/authentication/password_based:built_in_database/users/gw-1-sensors`,
    );
    expect(urls.some((u) => u.includes('/mqtt/retainer/message/'))).toBe(true);
  });

  it('deprovisionGateway sem tenantId não tenta limpar retained', async () => {
    await service.deprovisionGateway('gw-1');
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('/mqtt/retainer/'))).toBe(false);
  });
});
