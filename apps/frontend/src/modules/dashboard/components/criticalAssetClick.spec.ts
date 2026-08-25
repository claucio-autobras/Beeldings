import {
  resolveAssetClick,
  resolveAssetNavigateHref,
  type ClickableAsset,
} from './criticalAssetClick';

const asset = (over: Partial<ClickableAsset> = {}): ClickableAsset => ({
  state: 'running',
  deviceId: 'dev1',
  pointId: null,
  scadaScreenId: null,
  faultAlarmEventId: null,
  ...over,
});

describe('clique do card Ativos Críticos por perfil e estado', () => {
  it('falha abre o painel de primeira ação para ambos os perfis', () => {
    const a = asset({ state: 'fault', faultAlarmEventId: 'ev1' });
    expect(resolveAssetClick(a, { isAdmin: true, isCamera: false })).toEqual({ kind: 'firstAction' });
    expect(resolveAssetClick(a, { isAdmin: false, isCamera: false })).toEqual({ kind: 'firstAction' });
    // A navegação contextual do painel leva ao alarme em destaque.
    expect(resolveAssetNavigateHref(a, { isAdmin: false, isCamera: false })).toBe(
      '/alarms?state=open&highlight=ev1',
    );
  });

  it('técnico vai direto ao dispositivo com o ponto em destaque', () => {
    const a = asset({ pointId: 'p9' });
    expect(resolveAssetClick(a, { isAdmin: true, isCamera: false })).toEqual({
      kind: 'navigate',
      href: '/devices?deviceId=dev1&pointId=p9',
    });
  });

  it('técnico clicando num item sem resposta também vai ao ponto (nunca à lista genérica)', () => {
    const a = asset({ state: 'no_response', pointId: 'p9' });
    expect(resolveAssetClick(a, { isAdmin: true, isCamera: false })).toEqual({
      kind: 'navigate',
      href: '/devices?deviceId=dev1&pointId=p9',
    });
  });

  it('câmera continua indo ao CFTV para o técnico', () => {
    expect(resolveAssetClick(asset(), { isAdmin: true, isCamera: true })).toEqual({
      kind: 'navigate',
      href: '/cftv',
    });
  });

  it('cliente num item sem resposta vê o painel informativo SEM atalho ao SCADA', () => {
    const a = asset({ state: 'no_response', scadaScreenId: 'scr1' });
    expect(resolveAssetClick(a, { isAdmin: false, isCamera: false })).toEqual({
      kind: 'infoModal',
      shortcut: null,
    });
  });

  it('cliente num item saudável vê o painel informativo com atalho ao SCADA quando há tela ativa', () => {
    const a = asset({ state: 'running', scadaScreenId: 'scr1' });
    expect(resolveAssetClick(a, { isAdmin: false, isCamera: false })).toEqual({
      kind: 'infoModal',
      shortcut: { label: 'scada', href: '/scada/view/scr1' },
    });
  });

  it('cliente sem tela SCADA ativa vê o painel informativo sem atalho', () => {
    const a = asset({ state: 'stopped' });
    expect(resolveAssetClick(a, { isAdmin: false, isCamera: false })).toEqual({
      kind: 'infoModal',
      shortcut: null,
    });
  });

  it('cliente num ponto de câmera vê o painel com atalho ao CFTV', () => {
    const a = asset({ state: 'no_response', pointId: 'p1' });
    expect(resolveAssetClick(a, { isAdmin: false, isCamera: true })).toEqual({
      kind: 'infoModal',
      shortcut: { label: 'cftv', href: '/cftv' },
    });
  });
});
