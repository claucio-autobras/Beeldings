import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateRecipientInput {
  /** Usado por papéis globais para indicar o tenant-alvo; papéis de cliente ignoram. */
  tenantId?: string;
  name: string;
  email?: string;
  /** Telefone em E.164 (ex.: +5511912345678). */
  phone?: string;
  emailEnabled?: boolean;
  whatsappEnabled?: boolean;
  alarms?: boolean;
  insights?: boolean;
  allSites?: boolean;
  /** IDs de sites específicos — obrigatório quando allSites=false. */
  siteIds?: string[];
  active?: boolean;
}

export interface UpdateRecipientInput {
  name?: string;
  email?: string;
  phone?: string;
  emailEnabled?: boolean;
  whatsappEnabled?: boolean;
  alarms?: boolean;
  insights?: boolean;
  allSites?: boolean;
  siteIds?: string[];
  active?: boolean;
}

export interface ResolveRecipientsParams {
  tenantId: string;
  category: 'alarms' | 'insights';
  channel?: 'email' | 'whatsapp';
  /** Quando informado, inclui destinatários com escopo global OU que cubram este site. */
  siteId?: string;
}

export interface ResolvedRecipient {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

// ─── Validação ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164: + seguido de 8-15 dígitos. */
const PHONE_E164_RE = /^\+[1-9]\d{7,14}$/;

function validateContact(
  email: string | undefined | null,
  phone: string | undefined | null,
  emailEnabled: boolean,
  whatsappEnabled: boolean,
) {
  // Pelo menos um campo de contato.
  if (!email && !phone) {
    throw new BadRequestException('Informe ao menos um contato: e-mail ou telefone');
  }
  // Pelo menos um canal habilitado.
  if (!emailEnabled && !whatsappEnabled) {
    throw new BadRequestException('Habilite ao menos um canal: E-mail ou WhatsApp');
  }
  // Canal ativo exige o campo de contato correspondente.
  if (emailEnabled && !email) {
    throw new BadRequestException('Canal E-mail habilitado, mas e-mail não informado');
  }
  if (whatsappEnabled && !phone) {
    throw new BadRequestException('Canal WhatsApp habilitado, mas telefone não informado');
  }
  // Validação de formato.
  if (email && !EMAIL_RE.test(email)) {
    throw new BadRequestException('Formato de e-mail inválido');
  }
  if (phone && !PHONE_E164_RE.test(phone)) {
    throw new BadRequestException(
      'Telefone deve estar no formato E.164 (ex.: +5511912345678)',
    );
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

const RECIPIENT_INCLUDE = {
  sites: {
    include: { site: { select: { id: true, name: true } } },
    orderBy: { site: { name: 'asc' } } as Record<string, unknown>,
  },
} as const;

@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async findAll(tenantId: string | undefined) {
    const records = await this.prisma.notificationRecipient.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: RECIPIENT_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return records.map(toDto);
  }

  async findOne(id: string, tenantId: string | undefined) {
    const record = await this.prisma.notificationRecipient.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      include: RECIPIENT_INCLUDE,
    });
    if (!record) throw new NotFoundException(`Destinatário ${id} não encontrado`);
    return toDto(record);
  }

  async create(input: CreateRecipientInput, resolvedTenantId: string) {
    if (!input.name?.trim()) throw new BadRequestException('name é obrigatório');

    const emailEnabled = input.emailEnabled ?? false;
    const whatsappEnabled = input.whatsappEnabled ?? false;
    const allSites = input.allSites ?? true;

    const email = input.email?.trim() || undefined;
    const phone = input.phone?.trim() || undefined;

    validateContact(email, phone, emailEnabled, whatsappEnabled);

    const siteIds = allSites ? [] : (input.siteIds ?? []);
    if (!allSites && siteIds.length === 0) {
      throw new BadRequestException(
        'Informe ao menos um site quando "Todos os sites" estiver desabilitado',
      );
    }
    if (siteIds.length > 0) {
      await this.assertSitesBelongToTenant(siteIds, resolvedTenantId);
    }

    const record = await this.prisma.notificationRecipient.create({
      data: {
        tenantId: resolvedTenantId,
        name: input.name.trim(),
        email: email ?? null,
        phone: phone ?? null,
        emailEnabled,
        whatsappEnabled,
        alarms: input.alarms ?? true,
        insights: input.insights ?? false,
        allSites,
        active: input.active ?? true,
        sites: {
          create: siteIds.map((siteId) => ({ siteId })),
        },
      },
      include: RECIPIENT_INCLUDE,
    });
    return toDto(record);
  }

  async update(id: string, tenantId: string | undefined, input: UpdateRecipientInput) {
    const existing = await this.prisma.notificationRecipient.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      include: RECIPIENT_INCLUDE,
    });
    if (!existing) throw new NotFoundException(`Destinatário ${id} não encontrado`);

    // Merge dos campos de contato/canal com os existentes para re-validar.
    const email =
      'email' in input ? (input.email?.trim() || undefined) : (existing.email ?? undefined);
    const phone =
      'phone' in input ? (input.phone?.trim() || undefined) : (existing.phone ?? undefined);
    const emailEnabled = input.emailEnabled ?? existing.emailEnabled;
    const whatsappEnabled = input.whatsappEnabled ?? existing.whatsappEnabled;
    const allSites = input.allSites ?? existing.allSites;

    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException('name não pode ser vazio');
    }
    validateContact(email, phone, emailEnabled, whatsappEnabled);

    // Sites: validação e cálculo do conjunto efetivo.
    // siteIds é o novo conjunto explícito (se fornecido); undefined = manter existentes.
    const siteIds = !allSites && input.siteIds !== undefined ? input.siteIds : undefined;

    if (!allSites) {
      // Conjunto efetivo: input explícito OU associações já existentes.
      const effectiveCount =
        input.siteIds !== undefined ? input.siteIds.length : existing.sites.length;
      if (effectiveCount === 0) {
        throw new BadRequestException(
          'Informe ao menos um site quando "Todos os sites" estiver desabilitado',
        );
      }
    }
    if (siteIds && siteIds.length > 0) {
      await this.assertSitesBelongToTenant(siteIds, existing.tenantId);
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if ('email' in input) data.email = email ?? null;
    if ('phone' in input) data.phone = phone ?? null;
    if (input.emailEnabled !== undefined) data.emailEnabled = emailEnabled;
    if (input.whatsappEnabled !== undefined) data.whatsappEnabled = whatsappEnabled;
    if (input.alarms !== undefined) data.alarms = input.alarms;
    if (input.insights !== undefined) data.insights = input.insights;
    if (input.allSites !== undefined) data.allSites = allSites;
    if (input.active !== undefined) data.active = input.active;

    // Sites: substituição atômica via deleteMany + createMany.
    if (siteIds !== undefined) {
      await this.prisma.$transaction([
        this.prisma.notificationRecipientSite.deleteMany({ where: { recipientId: id } }),
        ...(siteIds.length > 0
          ? [
              this.prisma.notificationRecipientSite.createMany({
                data: siteIds.map((siteId) => ({ recipientId: id, siteId })),
                skipDuplicates: true,
              }),
            ]
          : []),
        this.prisma.notificationRecipient.update({ where: { id }, data }),
      ]);
    } else if (allSites && !existing.allSites) {
      // Switched to allSites=true: remove scoped sites.
      await this.prisma.$transaction([
        this.prisma.notificationRecipientSite.deleteMany({ where: { recipientId: id } }),
        this.prisma.notificationRecipient.update({ where: { id }, data }),
      ]);
    } else {
      await this.prisma.notificationRecipient.update({ where: { id }, data });
    }

    const updated = await this.prisma.notificationRecipient.findFirst({
      where: { id },
      include: RECIPIENT_INCLUDE,
    });
    return toDto(updated!);
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    const existing = await this.prisma.notificationRecipient.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Destinatário ${id} não encontrado`);
    await this.prisma.notificationRecipient.delete({ where: { id } });
  }

  // ── Resolução de destinatários ─────────────────────────────────────────────

  /**
   * Retorna todos os destinatários ativos que atendem ao contexto de envio:
   *  - tenant correto
   *  - categoria habilitada (alarms | insights)
   *  - canal habilitado (email | whatsapp) — se omitido, retorna todos os canais
   *  - escopo: allSites=true OU o site informado está na lista de sites do destinatário
   */
  async resolveRecipients(params: ResolveRecipientsParams): Promise<ResolvedRecipient[]> {
    if (!params.tenantId) {
      throw new BadRequestException('tenantId é obrigatório para resolver destinatários');
    }
    if (params.category !== 'alarms' && params.category !== 'insights') {
      throw new BadRequestException('category deve ser "alarms" ou "insights"');
    }
    if (params.channel && params.channel !== 'email' && params.channel !== 'whatsapp') {
      throw new BadRequestException('channel deve ser "email", "whatsapp" ou omitido');
    }

    const where: Record<string, unknown> = {
      tenantId: params.tenantId,
      active: true,
      [params.category]: true,
    };

    if (params.channel === 'email') where.emailEnabled = true;
    else if (params.channel === 'whatsapp') where.whatsappEnabled = true;

    // Escopo de site: allSites=true OU siteId está na lista de sites.
    if (params.siteId) {
      where.OR = [
        { allSites: true },
        { sites: { some: { siteId: params.siteId } } },
      ];
    } else {
      // Sem siteId: retorna apenas destinatários com escopo global.
      where.allSites = true;
    }

    const records = await this.prisma.notificationRecipient.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    });

    return records.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.email ? { email: r.email } : {}),
      ...(r.phone ? { phone: r.phone } : {}),
    }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertSitesBelongToTenant(siteIds: string[], tenantId: string): Promise<void> {
    const sites = await this.prisma.site.findMany({
      where: { id: { in: siteIds }, tenantId },
      select: { id: true },
    });
    if (sites.length !== siteIds.length) {
      throw new BadRequestException(
        'Um ou mais sites não foram encontrados ou não pertencem ao cliente',
      );
    }
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

type RecipientWithSites = {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  alarms: boolean;
  insights: boolean;
  allSites: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  sites: Array<{
    site: { id: string; name: string };
  }>;
};

function toDto(r: RecipientWithSites) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    emailEnabled: r.emailEnabled,
    whatsappEnabled: r.whatsappEnabled,
    alarms: r.alarms,
    insights: r.insights,
    allSites: r.allSites,
    active: r.active,
    sites: r.sites.map((s) => ({ id: s.site.id, name: s.site.name })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
