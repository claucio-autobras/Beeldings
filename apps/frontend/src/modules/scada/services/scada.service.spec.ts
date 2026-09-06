import {
  addScadaProject,
  downloadScreenExport,
  getScadaProjects,
  getScreenVersions,
  importScreen,
  resolveAssetUrl,
  restoreScreenVersion,
  updateScadaProjectCover,
} from './scada.service';

describe('serviço de projetos SCADA', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('envia a capa apenas no payload de adição e resolve a URL retornada', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'project-a',
        name: 'Edifício Aurora',
        siteId: 'site-a',
        tenantId: 'tenant-a',
        coverImageUrl: '/scada-assets/tenant-a/cover.jpg',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;

    const project = await addScadaProject('project-a', 'data:image/jpeg;base64,ZmFrZQ==');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(String(init.body))).toEqual({
      projectId: 'project-a',
      coverImageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
    });
    expect(project.coverImageUrl).toBe('/api/scada-assets/tenant-a/cover.jpg');
  });

  it('mantém a listagem compatível com projetos antigos sem capa', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify([{
        id: 'project-old',
        name: 'Projeto legado',
        siteId: 'site-a',
        tenantId: 'tenant-a',
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;

    await expect(getScadaProjects('tenant-a')).resolves.toEqual([expect.objectContaining({
      id: 'project-old',
      coverImageUrl: null,
    })]);
  });

  it('não transforma URLs externas ou data URLs e trata vazio como sem capa', () => {
    expect(resolveAssetUrl('/scada-assets/tenant-a/cover.webp')).toBe('/api/scada-assets/tenant-a/cover.webp');
    expect(resolveAssetUrl('/api/scada-assets/tenant-a/cover.webp')).toBe('/api/scada-assets/tenant-a/cover.webp');
    expect(resolveAssetUrl('https://cdn.example/cover.webp')).toBe('https://cdn.example/cover.webp');
    expect(resolveAssetUrl('data:image/png;base64,ZmFrZQ==')).toBe('data:image/png;base64,ZmFrZQ==');
    expect(resolveAssetUrl(null)).toBeUndefined();
  });

  it('envia uma nova capa no PATCH e resolve a URL retornada', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'project-a',
        name: 'Edifício Aurora',
        siteId: 'site-a',
        tenantId: 'tenant-a',
        coverImageUrl: '/scada-assets/tenant-a/new.webp',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;

    const project = await updateScadaProjectCover('project-a', 'data:image/webp;base64,ZmFrZQ==');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      coverImageDataUrl: 'data:image/webp;base64,ZmFrZQ==',
    });
    expect(project.coverImageUrl).toBe('/api/scada-assets/tenant-a/new.webp');
  });

  it('envia null no PATCH para remover a capa', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'project-a',
        name: 'Edifício Aurora',
        siteId: 'site-a',
        tenantId: 'tenant-a',
        coverImageUrl: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;

    await updateScadaProjectCover('project-a', null);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ coverImageDataUrl: null });
  });

  it('envia o arquivo visual para o projeto de destino', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'screen-new',
        name: 'Tela importada',
        tenantId: 'tenant-destino',
        siteId: 'site-destino',
        projectId: 'project-destino',
        width: 1920,
        height: 1080,
        status: 'active',
        isHome: false,
        widgets: [],
        settings: {},
        createdAt: '2026-09-05T12:00:00.000Z',
        updatedAt: '2026-09-05T12:00:00.000Z',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;

    const file = { format: 'bluebee-screen', version: 1, screen: { name: 'Visual' } };
    const screen = await importScreen({
      tenantId: 'tenant-destino',
      siteId: 'site-destino',
      projectId: 'project-destino',
      file,
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/scada/screens/import');
    expect(JSON.parse(String(init.body))).toEqual({
      tenantId: 'tenant-destino',
      siteId: 'site-destino',
      projectId: 'project-destino',
      file,
    });
    expect(screen.id).toBe('screen-new');
  });

  it('baixa a exportação com o nome informado pelo backend', async () => {
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalUrl = globalThis.URL;
    const click = jest.fn();
    const createObjectURL = jest.fn().mockReturnValue('blob:screen');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      createElement: jest.fn().mockReturnValue({ click, set href(value: string) { void value; }, set download(value: string) { void value; } }),
    } });
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: {
      ...originalUrl,
      createObjectURL,
      revokeObjectURL,
    } });
    global.fetch = jest.fn().mockResolvedValue(
      new Response('{"format":"bluebee-screen"}', {
        status: 200,
        headers: { 'Content-Disposition': "attachment; filename*=UTF-8''Tela%20visual.bluebee-screen" },
      }),
    ) as unknown as typeof fetch;

    await downloadScreenExport('screen-1');

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screen');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: originalUrl });
  });

  it('consulta versões e restaura uma versão específica', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'version-1', name: 'Antes', width: 1280, height: 720, status: 'active', createdAt: '2026-09-05T12:00:00.000Z' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'screen-1',
        name: 'Tela',
        tenantId: 'tenant-a',
        siteId: 'site-a',
        projectId: 'project-a',
        width: 1280,
        height: 720,
        status: 'active',
        isHome: false,
        widgets: [],
        settings: {},
        createdAt: '2026-09-05T12:00:00.000Z',
        updatedAt: '2026-09-05T12:00:00.000Z',
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(getScreenVersions('screen-1')).resolves.toHaveLength(1);
    await expect(restoreScreenVersion('screen-1', 'version-1')).resolves.toEqual(expect.objectContaining({ width: 1280 }));
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('/scada/screens/screen-1/versions/version-1/restore');
  });
});