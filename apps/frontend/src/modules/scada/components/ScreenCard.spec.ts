import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScreenCard } from './ScreenCard';
import type { ScadaScreen } from '../types/scada.types';

const React = jest.requireActual('react') as typeof import('react');
const componentSource = readFileSync(join(__dirname, 'ScreenCard.tsx'), 'utf8');
const globalStyles = readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8');

jest.mock('next/link', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      React.createElement('a', { href, ...props }, children),
  };
});

jest.mock('lucide-react', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const Icon = (props: Record<string, unknown>) => React.createElement('svg', props);
  return {
    CalendarDays: Icon,
    Edit2: Icon,
    Eye: Icon,
    Home: Icon,
    Loader2: Icon,
    MoreHorizontal: Icon,
    Pencil: Icon,
    Settings2: Icon,
    Trash2: Icon,
  };
});

const screen: ScadaScreen = {
  id: 'screen-1',
  name: 'Telas de utilidades',
  tenantId: 'tenant-1',
  projectId: 'project-1',
  width: 1920,
  height: 1080,
  status: 'active',
  isHome: false,
  widgets: [],
  settings: {
    backgroundColor: '#0f172a',
    gridOpacity: 0.2,
  },
  updatedAt: '2026-08-29T12:00:00.000Z',
};

function renderCard(canEdit = true) {
  return renderToStaticMarkup(
    // React.createElement keeps this regression test compatible with the
    // project's Jest convention, which discovers only *.spec.ts files.
    React.createElement(ScreenCard, {
      screen,
      canEdit,
      onRename: () => undefined,
      onSetHome: () => undefined,
      onDelete: () => undefined,
    }),
  );
}

describe('ScreenCard — ações de navegação e estabilidade visual', () => {
  it('renderiza as ações principais diretamente sobre a prévia e aponta para a tela correta', () => {
    const markup = renderCard();

    expect(markup).toContain('class="scada-screen-card group');
    expect(markup).toContain('data-testid="link-view-screen-screen-1"');
    expect(markup).toContain('href="/scada-view/screen-1"');
    expect(markup).toContain('data-testid="link-edit-screen-screen-1"');
    expect(markup).toContain('href="/scada/editor/screen-1"');
    expect(markup).toContain('scada-card-actions');
    expect(markup).not.toContain('hover:-translate-y');
    expect(markup).not.toContain('transition-[box-shadow,transform,border-color]');
  });

  it('oculta Editar para quem não tem permissão, sem remover Visualizar', () => {
    const markup = renderCard(false);

    expect(markup).toContain('data-testid="link-view-screen-screen-1"');
    expect(markup).not.toContain('data-testid="link-edit-screen-screen-1"');
    expect(markup).not.toContain('href="/scada/editor/screen-1"');
  });

  it('mantém Visualizar com primeiro plano claro independente do remapeamento slate do tema', () => {
    const markup = renderCard();

    expect(markup).toContain('border-white/60');
    expect(markup).toContain('text-white');
    expect(markup).not.toContain('text-slate-100');
  });

  it('mantém o menu administrativo separado das ações principais', () => {
    const markup = renderCard();

    expect(markup).toContain('data-testid="button-screen-menu-screen-1"');
    expect(componentSource).toContain('role="menu"');
    expect(componentSource).toContain('data-testid={`button-rename-screen-${screen.id}`}');
    expect(componentSource).toContain('data-testid={`button-set-home-screen-${screen.id}`}');
    expect(componentSource).toContain('data-testid={`button-delete-screen-${screen.id}`}');
  });

  it('revela as ações no hover de mouse sem usar transformação no card', () => {
    expect(globalStyles).toContain('@media (hover: hover) and (pointer: fine)');
    expect(globalStyles).toContain('.scada-screen-card:hover .scada-card-actions');
    expect(globalStyles).toContain('@media (hover: none), (pointer: coarse)');
    expect(globalStyles).not.toContain('.group:hover .scada-card-actions');
    expect(componentSource).toContain('scada-card-actions pointer-events-auto');
    expect(componentSource).toContain('group-focus-within:opacity-100');
    expect(componentSource).not.toContain('scada-card-actions invisible');
    expect(componentSource).not.toContain('scada-card-actions pointer-events-none');
    expect(componentSource).not.toContain('hover:-translate-y');
    expect(componentSource).not.toContain('hover:scale-');
  });
});