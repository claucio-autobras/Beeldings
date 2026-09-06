'use client';

import { useQuery } from '@tanstack/react-query';
import { getScreens } from '../services/scada.service';
import type {
  NavSidebarWidget,
  NavToolbarWidget,
  ScadaScreen,
} from '../types/scada.types';

/**
 * Layout do projeto — barras de navegação (toolbar/sidebar) marcadas como
 * "fixas em todas as telas do projeto" (`pinnedToProject`). O layout é derivado
 * das telas do projeto (o flag vive no JSON de widgets da tela de origem), sem
 * endpoint dedicado: quem desfixa/apaga a barra na origem remove o layout de todas.
 */

export interface ProjectLayoutBar<T> {
  widget: T;
  sourceScreenId: string;
  sourceScreenName: string;
}

export interface ProjectLayout {
  toolbar: ProjectLayoutBar<NavToolbarWidget> | null;
  sidebar: ProjectLayoutBar<NavSidebarWidget> | null;
  /** Ids de todas as telas do projeto — decide se a navegação fica "dentro" do layout. */
  screenIds: string[];
}

export function deriveProjectLayout(screens: ScadaScreen[]): ProjectLayout {
  let toolbar: ProjectLayoutBar<NavToolbarWidget> | null = null;
  let sidebar: ProjectLayoutBar<NavSidebarWidget> | null = null;
  for (const s of screens) {
    for (const w of s.widgets) {
      if (w.type === 'nav-toolbar' && w.pinnedToProject && w.visible !== false && !toolbar) {
        toolbar = { widget: w, sourceScreenId: s.id, sourceScreenName: s.name };
      }
      if (w.type === 'nav-sidebar' && w.pinnedToProject && w.visible !== false && !sidebar) {
        sidebar = { widget: w, sourceScreenId: s.id, sourceScreenName: s.name };
      }
    }
  }
  return { toolbar, sidebar, screenIds: screens.map((s) => s.id) };
}

export function useProjectLayout(projectId: string | undefined): {
  layout: ProjectLayout | null;
  loading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['scada-project-layout', projectId ?? null],
    queryFn: () => getScreens({ projectId }),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  });
  return {
    layout: data ? deriveProjectLayout(data) : null,
    loading: Boolean(projectId) && isLoading,
  };
}
