import { ServiceUnavailableException } from '@nestjs/common';
import { RequestsService, mapFailure } from './requests.service.js';
import type { InfraspeakClient } from '../infrastructure/infraspeak.client.js';
import type { ConfigService } from '@nestjs/config';

/**
 * Payload REAL capturado do sandbox da Infraspeak (GET /v3/failures) em
 * 20/07/2026. Campos sensíveis mantidos como vieram (dados de sandbox).
 */
const REAL_FAILURE_ITEM = {
  type: 'failure',
  id: '709936',
  attributes: {
    uuid: '6f985977-dbd5-4ed1-be56-de8011606769',
    failure_id: 709936,
    problem_id: 28310,
    problem_name: '01. Hidráulica / Esgoto - 01.01. Banheira',
    status: 'WAITING_APPROVAL',
    state: 'WAITING_APPROVAL',
    report_date: '2026-07-08 10:53:01',
    completed_date: null,
    approved_date: null,
    paused_date: null,
    state_description: null,
    description: '',
    observations: null,
    entity_id: 393,
    priority: 2,
    priority_text: 'NORMAL',
    client_id: 75473,
    client_code: 'CLI-0001',
    client_name: 'Lojas Atlas (CLI-0001)',
    local_id: 388053,
    local_code: 'BLD-0003.ED.EXT',
    local_name: 'BLD-0003 - Edifício Principal - Área Externa',
    root_local_id: 387906,
    solved: false,
    confirmed: false,
    next_schedule: null,
    message_count: 0,
    supplier_id: null,
    signature_status: 'NOT_SIGNED',
    last_status_change_date: '2026-07-08 10:53:01',
    next_sla_date: '2026-07-08 18:53:01',
    started_date: null,
    created_at: '2026-07-08 10:53:01',
    updated_at: '2026-07-08 10:53:01',
    date_deleted: null,
  },
};

describe('mapFailure', () => {
  it('mapeia o payload real do sandbox para o formato interno', () => {
    const mapped = mapFailure(REAL_FAILURE_ITEM);

    expect(mapped.id).toBe(709936);
    expect(mapped.uuid).toBe('6f985977-dbd5-4ed1-be56-de8011606769');
    expect(mapped.state).toBe('WAITING_APPROVAL');
    expect(mapped.priority).toBe(2);
    expect(mapped.priorityText).toBe('NORMAL');
    expect(mapped.problemId).toBe(28310);
    expect(mapped.problemName).toBe('01. Hidráulica / Esgoto - 01.01. Banheira');
    expect(mapped.clientId).toBe(75473);
    expect(mapped.clientCode).toBe('CLI-0001');
    expect(mapped.clientName).toBe('Lojas Atlas (CLI-0001)');
    expect(mapped.localId).toBe(388053);
    expect(mapped.localCode).toBe('BLD-0003.ED.EXT');
    expect(mapped.localName).toBe('BLD-0003 - Edifício Principal - Área Externa');
    expect(mapped.reportDate).toBe('2026-07-08 10:53:01');
    expect(mapped.nextSlaDate).toBe('2026-07-08 18:53:01');
    expect(mapped.lastStatusChangeDate).toBe('2026-07-08 10:53:01');
    expect(mapped.solved).toBe(false);
    expect(mapped.confirmed).toBe(false);
    // Campos nulos permanecem null (nunca inventados)
    expect(mapped.completedDate).toBeNull();
    expect(mapped.approvedDate).toBeNull();
    expect(mapped.startedDate).toBeNull();
    expect(mapped.pausedDate).toBeNull();
    expect(mapped.observations).toBeNull();
    expect(mapped.stateDescription).toBeNull();
    // Descrição vazia vira null
    expect(mapped.description).toBeNull();
  });

  it('preserva o payload original íntegro em raw', () => {
    const mapped = mapFailure(REAL_FAILURE_ITEM);
    expect(mapped.raw).toBe(REAL_FAILURE_ITEM);
    expect(mapped.raw.attributes?.signature_status).toBe('NOT_SIGNED');
    expect(mapped.raw.attributes?.entity_id).toBe(393);
  });

  it('usa o id do envelope quando attributes.failure_id estiver ausente', () => {
    const mapped = mapFailure({ type: 'failure', id: '123', attributes: {} });
    expect(mapped.id).toBe(123);
  });

  it('usa status como fallback de state', () => {
    const mapped = mapFailure({ id: 1, attributes: { status: 'CLOSED' } });
    expect(mapped.state).toBe('CLOSED');
  });

  it('não quebra com item malformado (null/sem attributes)', () => {
    expect(mapFailure(null).id).toBeNull();
    expect(mapFailure({}).uuid).toBeNull();
    expect(mapFailure('lixo').clientName).toBeNull();
  });
});

describe('RequestsService', () => {
  const makeConfig = (path: string | undefined): ConfigService =>
    ({ get: jest.fn().mockReturnValue(path) }) as unknown as ConfigService;

  it('lança ServiceUnavailable quando INFRASPEAK_REQUESTS_PATH não está configurado', async () => {
    const client = { getAll: jest.fn() } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig(undefined));
    await expect(service.findAll()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((client as unknown as { getAll: jest.Mock }).getAll).not.toHaveBeenCalled();
  });

  it('consolida páginas e devolve chamados mapeados com raw preservado', async () => {
    const client = {
      getAll: jest.fn().mockResolvedValue({ data: [REAL_FAILURE_ITEM], pages: 1 }),
    } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));

    const result = await service.findAll({ s_state: 'WAITING_APPROVAL' });

    expect((client as unknown as { getAll: jest.Mock }).getAll).toHaveBeenCalledWith('failures', {
      query: { s_state: 'WAITING_APPROVAL' },
    });
    expect(result.resource).toBe('failures');
    expect(result.total).toBe(1);
    expect(result.pages).toBe(1);
    expect(result.data[0].id).toBe(709936);
    expect(result.data[0].raw).toBe(REAL_FAILURE_ITEM);
  });

  it('propaga erros do client (ex.: 401/429) sem engolir', async () => {
    const boom = new Error('Infraspeak 401');
    const client = { getAll: jest.fn().mockRejectedValue(boom) } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));
    await expect(service.findAll()).rejects.toBe(boom);
  });
});
