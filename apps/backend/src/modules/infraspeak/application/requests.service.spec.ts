import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { RequestsService, buildCreateFailurePayload, mapFailure } from './requests.service.js';
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

  it('create envia o payload snake_case e devolve o chamado mapeado', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ data: REAL_FAILURE_ITEM }),
    } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));

    const created = await service.create({
      problemId: 28310,
      localId: 387903,
      description: 'Vazamento na bancada',
      priority: 2,
    });

    expect((client as unknown as { post: jest.Mock }).post).toHaveBeenCalledWith('failures', {
      problem_id: 28310,
      local_id: 387903,
      description: 'Vazamento na bancada',
      priority: 2,
    });
    expect(created.id).toBe(709936);
    expect(created.raw).toBe(REAL_FAILURE_ITEM);
  });

  it('getFormOptions monta problems folha com allClients/clientIds e locals com clientId', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({
        data: [
          {
            type: 'problem_area',
            id: '28309',
            attributes: { problem_id: 28309, name: '01. Hidráulica', all_clients: true },
            relationships: { children: { data: [] }, clients: { data: [] } },
          },
        ],
        included: [
          {
            type: 'problem_type',
            id: '28310',
            attributes: {
              problem_id: 28310,
              name: '01.01. Banheira',
              full_name: '01. Hidráulica - 01.01. Banheira',
              parent_id: 28309,
            },
          },
        ],
      }),
      getAll: jest.fn().mockResolvedValue({
        data: [
          {
            type: 'building',
            id: '387902',
            attributes: { local_id: 387902, name: 'Dummy', full_name: 'Dummy', client_id: 75472 },
          },
          {
            type: 'location-folder',
            id: '387999',
            attributes: { local_id: 387999, name: 'Pasta', full_name: 'Dummy - Pasta' },
          },
          {
            type: 'location',
            id: '387903',
            attributes: {
              local_id: 387903,
              name: 'Geral',
              full_name: 'Dummy - Geral',
              root_parent_id: 387902,
            },
          },
        ],
        pages: 1,
      }),
    } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));

    const options = await service.getFormOptions();

    // Confirma expanded=children,clients (novo parâmetro).
    expect((client as unknown as { get: jest.Mock }).get).toHaveBeenCalledWith('problems', {
      query: { expanded: 'children,clients', limit: 400 },
    });

    // Problem: herda allClients/clientIds da área pai.
    expect(options.problems).toEqual([
      {
        id: 28310,
        name: '01.01. Banheira',
        fullName: '01. Hidráulica - 01.01. Banheira',
        areaId: 28309,
        areaName: '01. Hidráulica',
        allClients: true,
        clientIds: [],
      },
    ]);

    // Locals: apenas type=location; clientId resolvido via root_parent_id.
    expect((client as unknown as { getAll: jest.Mock }).getAll).toHaveBeenCalledWith('locations');
    expect(options.locals).toEqual([
      { id: 387903, name: 'Geral', fullName: 'Dummy - Geral', clientId: 75472 },
    ]);
  });

  it('getFormOptions: area com all_clients=false propaga clientIds restritos aos filhos', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({
        data: [
          {
            type: 'problem_area',
            id: '28999',
            attributes: { problem_id: 28999, name: 'TI', all_clients: false },
            relationships: {
              children: { data: [] },
              clients: { data: [{ type: 'client', id: '75473' }] },
            },
          },
        ],
        included: [
          {
            type: 'problem_type',
            id: '29000',
            attributes: {
              problem_id: 29000,
              name: 'Falha de Sistema',
              full_name: 'TI - Falha de Sistema',
              parent_id: 28999,
            },
          },
        ],
      }),
      getAll: jest.fn().mockResolvedValue({ data: [], pages: 1 }),
    } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));

    const options = await service.getFormOptions();

    expect(options.problems).toHaveLength(1);
    const problem = options.problems[0];
    expect(problem.allClients).toBe(false);
    expect(problem.clientIds).toEqual([75473]);
  });

  it('getFormOptions: local sem root_parent_id no mapa de prédios recebe clientId=null', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({ data: [], included: [] }),
      getAll: jest.fn().mockResolvedValue({
        data: [
          // Nenhum building no payload — location não pode resolver o clientId.
          {
            type: 'location',
            id: '387903',
            attributes: {
              local_id: 387903,
              name: 'Geral',
              full_name: 'Dummy - Geral',
              root_parent_id: 999999, // building inexistente no payload
            },
          },
        ],
        pages: 1,
      }),
    } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));

    const options = await service.getFormOptions();

    expect(options.locals).toEqual([
      { id: 387903, name: 'Geral', fullName: 'Dummy - Geral', clientId: null },
    ]);
  });

  it('getFormOptions: local sem root_parent_id (null/ausente) recebe clientId=null', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({ data: [], included: [] }),
      getAll: jest.fn().mockResolvedValue({
        data: [
          {
            type: 'building',
            id: '387902',
            attributes: { local_id: 387902, name: 'B', full_name: 'B', client_id: 75472 },
          },
          {
            type: 'location',
            id: '387910',
            attributes: {
              local_id: 387910,
              name: 'Sala',
              full_name: 'Sala',
              // root_parent_id ausente
            },
          },
        ],
        pages: 1,
      }),
    } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig('failures'));

    const options = await service.getFormOptions();

    expect(options.locals[0].clientId).toBeNull();
  });

  it('create exige recurso configurado', async () => {
    const client = { post: jest.fn() } as unknown as InfraspeakClient;
    const service = new RequestsService(client, makeConfig(undefined));
    await expect(
      service.create({ problemId: 1, localId: 1, description: 'x' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('buildCreateFailurePayload', () => {
  it('monta o payload mínimo com local_id', () => {
    expect(buildCreateFailurePayload({ problemId: 28310, localId: 387903, description: ' abc ' })).toEqual({
      problem_id: 28310,
      local_id: 387903,
      description: 'abc',
    });
  });

  it('aceita element_id como alternativa ao local_id', () => {
    expect(buildCreateFailurePayload({ problemId: 1, elementId: 42, description: 'x' })).toEqual({
      problem_id: 1,
      element_id: 42,
      description: 'x',
    });
  });

  it('rejeita quando local e elemento vêm preenchidos ao mesmo tempo (XOR)', () => {
    expect(() =>
      buildCreateFailurePayload({ problemId: 1, localId: 2, elementId: 3, description: 'x' }),
    ).toThrow(BadRequestException);
  });

  it('rejeita descrição vazia/apenas espaços', () => {
    expect(() => buildCreateFailurePayload({ problemId: 1, localId: 1, description: '  ' })).toThrow(
      BadRequestException,
    );
  });

  it('rejeita problemId ausente/inválido', () => {
    expect(() =>
      buildCreateFailurePayload({ problemId: 0 as number, localId: 1, description: 'x' }),
    ).toThrow(BadRequestException);
    expect(() =>
      buildCreateFailurePayload({ problemId: NaN as number, localId: 1, description: 'x' }),
    ).toThrow(BadRequestException);
  });

  it('rejeita quando não há local nem elemento', () => {
    expect(() => buildCreateFailurePayload({ problemId: 1, description: 'x' })).toThrow(
      BadRequestException,
    );
  });

  it('valida a faixa de prioridade 1–4 (regra confirmada no sandbox)', () => {
    expect(() =>
      buildCreateFailurePayload({ problemId: 1, localId: 1, description: 'x', priority: 99 }),
    ).toThrow(BadRequestException);
    expect(
      buildCreateFailurePayload({ problemId: 1, localId: 1, description: 'x', priority: 4 }).priority,
    ).toBe(4);
  });
});
