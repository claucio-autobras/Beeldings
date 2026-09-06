import { apiPost } from './api-client';

/**
 * apiPost precisa tolerar respostas SEM corpo (204 No Content / body vazio) —
 * caso do POST /gateways/:id/update/cancel. Antes, res.json() num 204 lançava
 * "Unexpected end of JSON input" mesmo com a ação aplicada no backend, e a UI
 * mostrava erro falso ao operador.
 */
describe('apiPost — respostas sem corpo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('204 No Content resolve sem tentar parsear JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;

    await expect(apiPost<void>('/gateways/gw-1/update/cancel', {})).resolves.toBeUndefined();
  });

  it('200 com corpo vazio também resolve sem erro de parse', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('', { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(apiPost<void>('/qualquer', {})).resolves.toBeUndefined();
  });

  it('200 com JSON continua parseando normalmente', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '1.11.2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(apiPost<{ version: string }>('/gateways/gw-1/update', {})).resolves.toEqual({
      version: '1.11.2',
    });
  });

  it('erro da API continua lançando com a mensagem do backend', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Não há atualização em andamento' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(apiPost('/gateways/gw-1/update/cancel', {})).rejects.toThrow(
      'Não há atualização em andamento',
    );
  });
});
