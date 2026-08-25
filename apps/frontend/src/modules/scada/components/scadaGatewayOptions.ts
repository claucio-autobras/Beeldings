import type { GatewayItem } from '@/modules/gateways/services/gateways.service';
import type { ProjectItem } from '@/modules/projects/services/projects.service';

export interface ScadaGatewayOption {
  gateway: GatewayItem;
  projectId: string | null;
  projectName?: string;
  compatible: boolean;
  availabilityReason: 'available' | 'already-added' | 'no-site-project';
}

/**
 * Gateways are the operator-facing choice, while the selected project remains
 * the persisted SCADA anchor. A shared gateway is compatible when this site
 * has at least one project linked to it.
 */
export function resolveScadaGatewayOptions(
  gateways: GatewayItem[],
  projects: ProjectItem[],
  siteId: string,
  alreadyAddedIds: Set<string>,
): ScadaGatewayOption[] {
  return gateways
    .map((gateway) => {
      const siteProjects = projects.filter(
        (project) =>
          project.tenantId === gateway.tenantId &&
          project.siteId === siteId &&
          project.gateway?.id === gateway.id,
      );
      const compatibleProjects = siteProjects.filter(
        (project) =>
          !alreadyAddedIds.has(project.id),
      );
      const project = compatibleProjects[0];
      const availabilityReason: ScadaGatewayOption['availabilityReason'] = project
        ? 'available'
        : siteProjects.length > 0
          ? 'already-added'
          : 'no-site-project';
      return {
        gateway,
        projectId: project?.id ?? null,
        projectName: project?.name,
        compatible: Boolean(siteId && project),
        availabilityReason,
      };
    })
    .sort((a, b) => {
      if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
      return a.gateway.id.localeCompare(b.gateway.id);
    });
}
