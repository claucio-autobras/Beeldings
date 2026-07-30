import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ScadaScreen, ScadaComponent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateScadaScreenDto } from './dtos/create-scada-screen.dto.js';
import type { UpdateScadaScreenDto } from './dtos/update-scada-screen.dto.js';

export interface ScadaScreenFilters {
  tenantId?: string;
  siteId?: string;
  projectId?: string;
}

export interface ScadaProject {
  id: string;
  name: string;
  siteId: string;
  tenantId: string;
}

@Injectable()
export class ScadaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: ScadaScreenFilters): Promise<ScadaScreen[]> {
    return this.prisma.scadaScreen.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.siteId ? { siteId: filters.siteId } : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ─── Projetos do SCADA (cards da landing) ────────────────────────────────────

  /** Projetos marcados como visíveis no SCADA, opcionalmente filtrados por tenant. */
  async findEnabledProjects(tenantId: string | undefined): Promise<ScadaProject[]> {
    return this.prisma.project.findMany({
      where: { scadaEnabled: true, ...(tenantId ? { tenantId } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, siteId: true, tenantId: true },
    });
  }

  /** Adiciona um projeto existente ao SCADA (marca a flag). Valida o escopo do tenant. */
  async enableProject(projectId: string, tenantId: string | undefined): Promise<ScadaProject> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id: projectId, tenantId } : { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }
    return this.prisma.project.update({
      where: { id: projectId },
      data: { scadaEnabled: true },
      select: { id: true, name: true, siteId: true, tenantId: true },
    });
  }

  /**
   * Remove o projeto do SCADA: apaga APENAS as telas (scada_screens) do projeto e
   * desmarca a flag `scadaEnabled`. NUNCA toca no gateway, nos dispositivos ou no
   * registro do projeto — a exclusão do gateway é responsabilidade exclusiva do
   * módulo `projects` (Admin) e jamais é acionada por aqui.
   */
  async removeProjectFromScada(projectId: string, tenantId: string | undefined): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id: projectId, tenantId } : { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }
    await this.prisma.$transaction([
      // Apaga só as telas SCADA deste projeto (escopadas ao tenant por segurança).
      this.prisma.scadaScreen.deleteMany({
        where: { projectId, ...(tenantId ? { tenantId } : {}) },
      }),
      // Desmarca a flag para o card sair da landing. Não altera mais nada do projeto.
      this.prisma.project.update({
        where: { id: projectId },
        data: { scadaEnabled: false },
      }),
    ]);
  }

  async findOne(id: string, tenantId: string | undefined): Promise<ScadaScreen> {
    const screen = await this.prisma.scadaScreen.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });
    if (!screen) {
      throw new NotFoundException(`Tela SCADA ${id} não encontrada`);
    }
    return screen;
  }

  async create(dto: CreateScadaScreenDto): Promise<ScadaScreen> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name é obrigatório');
    }
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    // Valida que o projeto/site informados pertencem ao tenant (isolamento).
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, tenantId: dto.tenantId },
        select: { id: true, siteId: true },
      });
      if (!project) {
        throw new NotFoundException(`Projeto ${dto.projectId} não encontrado para este cliente`);
      }
    } else if (dto.siteId) {
      const site = await this.prisma.site.findFirst({
        where: { id: dto.siteId, tenantId: dto.tenantId },
        select: { id: true },
      });
      if (!site) {
        throw new NotFoundException(`Site ${dto.siteId} não encontrado para este cliente`);
      }
    }

    return this.prisma.scadaScreen.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        tenantId: dto.tenantId,
        siteId: dto.siteId ?? null,
        projectId: dto.projectId ?? null,
        width: dto.width ?? 1920,
        height: dto.height ?? 1080,
        widgets: (dto.widgets ?? []) as Prisma.InputJsonValue,
        settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(
    id: string,
    tenantId: string | undefined,
    dto: UpdateScadaScreenDto,
  ): Promise<ScadaScreen> {
    // Garante que a tela existe e pertence ao tenant antes de alterar.
    await this.findOne(id, tenantId);

    const data: Prisma.ScadaScreenUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() ?? null;
    if (dto.siteId !== undefined) data.site = dto.siteId ? { connect: { id: dto.siteId } } : { disconnect: true };
    if (dto.projectId !== undefined) {
      data.project = dto.projectId ? { connect: { id: dto.projectId } } : { disconnect: true };
    }
    if (dto.width !== undefined) data.width = dto.width;
    if (dto.height !== undefined) data.height = dto.height;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.widgets !== undefined) data.widgets = dto.widgets as Prisma.InputJsonValue;
    if (dto.settings !== undefined) {
      // `settings.components` é LEGADO (biblioteca embutida na tela antes da
      // biblioteca global por tenant). Só a migração pode removê-lo; saves da
      // tela nunca o regravam nem o apagam — preserva o valor atual do banco.
      const { components: _legacy, ...incoming } = dto.settings as Record<string, unknown>;
      const current = await this.prisma.scadaScreen.findUnique({ where: { id }, select: { settings: true } });
      const currentSettings = (current?.settings ?? {}) as Record<string, unknown>;
      const preserved = Array.isArray(currentSettings.components)
        ? { components: currentSettings.components }
        : {};
      data.settings = { ...incoming, ...preserved } as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.scadaScreen.update({ where: { id }, data });

    // Layout do projeto: se a tela salvou barras de navegação fixas
    // (pinnedToProject), garante que só exista UMA toolbar e UMA sidebar fixa
    // por projeto — desfixa as barras do mesmo tipo nas demais telas.
    if (dto.widgets !== undefined) {
      await this.unpinConflictingNavWidgets(updated);
    }

    return updated;
  }

  /**
   * Só uma nav-toolbar e uma nav-sidebar podem estar "fixas no projeto".
   * Quando esta tela salva uma barra fixa, remove o flag `pinnedToProject`
   * das barras do MESMO tipo no JSON de widgets das outras telas do projeto.
   */
  private async unpinConflictingNavWidgets(screen: ScadaScreen): Promise<void> {
    if (!screen.projectId) return;
    const widgets = Array.isArray(screen.widgets) ? (screen.widgets as Array<Record<string, unknown>>) : [];
    const pinnedKinds = new Set(
      widgets
        .filter((w) => w && (w.type === 'nav-toolbar' || w.type === 'nav-sidebar') && w.pinnedToProject === true)
        .map((w) => w.type as string),
    );
    if (pinnedKinds.size === 0) return;

    const siblings = await this.prisma.scadaScreen.findMany({
      where: { projectId: screen.projectId, tenantId: screen.tenantId, id: { not: screen.id } },
      select: { id: true, widgets: true },
    });

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const sib of siblings) {
      const sibWidgets = Array.isArray(sib.widgets) ? (sib.widgets as Array<Record<string, unknown>>) : [];
      let changed = false;
      const next = sibWidgets.map((w) => {
        if (w && pinnedKinds.has(w.type as string) && w.pinnedToProject === true) {
          changed = true;
          return { ...w, pinnedToProject: false };
        }
        return w;
      });
      if (changed) {
        updates.push(
          this.prisma.scadaScreen.update({
            where: { id: sib.id },
            data: { widgets: next as Prisma.InputJsonValue },
          }),
        );
      }
    }
    if (updates.length > 0) await this.prisma.$transaction(updates);
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    await this.findOne(id, tenantId);
    await this.prisma.scadaScreen.delete({ where: { id } });
  }

  // ─── Biblioteca global de componentes ("Meus Componentes") ──────────────────
  // Escopada por tenant: salvo em qualquer tela, disponível em todas as telas
  // do mesmo cliente. `widgets` é JSON opaco — o frontend é dono do schema.

  async findComponents(tenantId: string | undefined): Promise<ScadaComponent[]> {
    return this.prisma.scadaComponent.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'asc' },
    });
  }

  async createComponent(dto: {
    id?: string;
    name: string;
    tenantId: string;
    width: number;
    height: number;
    widgets: unknown[];
  }): Promise<ScadaComponent> {
    if (!dto.name?.trim()) throw new BadRequestException('name é obrigatório');
    if (!dto.tenantId?.trim()) throw new BadRequestException('tenantId é obrigatório');
    if (!Array.isArray(dto.widgets) || dto.widgets.length === 0) {
      throw new BadRequestException('widgets é obrigatório');
    }
    return this.prisma.scadaComponent.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        name: dto.name.trim(),
        tenantId: dto.tenantId,
        width: Math.max(1, Math.round(dto.width)),
        height: Math.max(1, Math.round(dto.height)),
        widgets: dto.widgets as Prisma.InputJsonValue,
      },
    });
  }

  async deleteComponent(id: string, tenantId: string | undefined): Promise<void> {
    const found = await this.prisma.scadaComponent.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Componente ${id} não encontrado`);
    await this.prisma.scadaComponent.delete({ where: { id } });
  }

  /**
   * Migra componentes legados embutidos em `settings.components` de cada tela
   * para a biblioteca global do tenant. Idempotente e SEM PERDA: só considera
   * duplicata um id já migrado no mesmo tenant ou conteúdo idêntico (nome +
   * dimensões + widgets, comparados por JSON canônico) — nunca heurísticas
   * fracas como "mesmo nome". O campo legado `components` da tela só é removido
   * quando TODOS os componentes daquela tela foram migrados ou são duplicatas
   * comprovadas; qualquer falha preserva o settings para nova tentativa.
   */
  async migrateLegacyComponents(): Promise<{ migrated: number; skipped: number; screens: number }> {
    const screens = await this.prisma.scadaScreen.findMany({
      select: { id: true, tenantId: true, settings: true },
    });
    let migrated = 0;
    let skipped = 0;
    let touched = 0;
    const existing = await this.prisma.scadaComponent.findMany({
      select: { id: true, tenantId: true, name: true, width: true, height: true, widgets: true },
    });
    // id → tenant dono (ids são globais; um id de outro tenant NÃO é duplicata).
    const tenantById = new Map(existing.map((c) => [c.id, c.tenantId]));
    // Conteúdo canônico por tenant: mesma composição exata = duplicata verdadeira.
    const contentKey = (tenantId: string, name: string, width: number, height: number, widgets: unknown[]) =>
      `${tenantId}|${name}|${width}x${height}|${JSON.stringify(widgets)}`;
    const byContent = new Set(
      existing.map((c) =>
        contentKey(c.tenantId, c.name, c.width, c.height, Array.isArray(c.widgets) ? (c.widgets as unknown[]) : []),
      ),
    );

    for (const screen of screens) {
      const settings = (screen.settings ?? {}) as Record<string, unknown>;
      const comps = Array.isArray(settings.components) ? (settings.components as Array<Record<string, unknown>>) : [];
      if (comps.length === 0) continue;
      touched += 1;
      let allHandled = true;
      for (const comp of comps) {
        const id = typeof comp.id === 'string' ? comp.id : undefined;
        const name = typeof comp.name === 'string' ? comp.name : 'Componente';
        const widgets = Array.isArray(comp.widgets) ? comp.widgets : [];
        const width = Math.max(1, Math.round(Number(comp.width) || 1));
        const height = Math.max(1, Math.round(Number(comp.height) || 1));
        if (widgets.length === 0) {
          // Componente vazio não tem o que preservar.
          skipped += 1;
          continue;
        }
        const key = contentKey(screen.tenantId, name, width, height, widgets);
        const idTaken = id ? tenantById.get(id) : undefined;
        if ((id && idTaken === screen.tenantId) || byContent.has(key)) {
          skipped += 1; // já migrado (mesmo id no tenant) ou conteúdo idêntico
          continue;
        }
        try {
          const created = await this.prisma.scadaComponent.create({
            data: {
              // Preserva o id legado, exceto se colidir com id de OUTRO tenant.
              ...(id && !idTaken ? { id } : {}),
              name,
              tenantId: screen.tenantId,
              width,
              height,
              widgets: widgets as Prisma.InputJsonValue,
            },
          });
          tenantById.set(created.id, screen.tenantId);
          byContent.add(key);
          migrated += 1;
        } catch {
          allHandled = false; // falhou: mantém o legado na tela para nova tentativa
        }
      }
      // Só remove o campo legado quando NADA ficou para trás nesta tela.
      if (allHandled) {
        const { components: _legacy, ...rest } = settings;
        await this.prisma.scadaScreen.update({
          where: { id: screen.id },
          data: { settings: rest as Prisma.InputJsonValue },
        });
      }
    }
    return { migrated, skipped, screens: touched };
  }

  /**
   * Define esta tela como a inicial ("home") do projeto. Garante que apenas UMA
   * tela do mesmo projeto fique marcada — as demais são desmarcadas na mesma transação.
   */
  async setHome(id: string, tenantId: string | undefined): Promise<ScadaScreen> {
    const screen = await this.findOne(id, tenantId);
    await this.prisma.$transaction([
      this.prisma.scadaScreen.updateMany({
        where: {
          tenantId: screen.tenantId,
          projectId: screen.projectId,
          id: { not: id },
          isHome: true,
        },
        data: { isHome: false },
      }),
      this.prisma.scadaScreen.update({ where: { id }, data: { isHome: true } }),
    ]);
    return this.prisma.scadaScreen.findUniqueOrThrow({ where: { id } });
  }
}
