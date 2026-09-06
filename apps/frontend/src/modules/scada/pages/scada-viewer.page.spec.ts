import { getViewerBackHref } from './scada-viewer.page';

describe('ScadaViewerPage — retorno standalone', () => {
  it('volta diretamente para o projeto quando a tela pertence a um projeto', () => {
    expect(getViewerBackHref('project-123')).toBe('/scada/project/project-123');
  });

  it('mantém a landing como fallback para telas sem projeto', () => {
    expect(getViewerBackHref(undefined)).toBe('/scada');
    expect(getViewerBackHref(null)).toBe('/scada');
  });

  it('não deixa ids especiais escaparem do segmento da rota', () => {
    expect(getViewerBackHref('project/123')).toBe('/scada/project/project%2F123');
  });
});