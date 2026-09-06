import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ScadaAssetService } from './scada-asset.service.js';
import { ScadaObjectStorageService } from '../infrastructure/scada-object-storage.service.js';
import { ScadaService } from './scada.service.js';

export const SCADA_SCREEN_TRANSFER_FORMAT = 'bluebee-screen';
export const SCADA_SCREEN_TRANSFER_VERSION = 1;

export interface ScadaScreenTransferAsset {
  id: string;
  dataUrl: string;
  contentType: string;
}

export interface ScadaScreenTransferFile {
  format: typeof SCADA_SCREEN_TRANSFER_FORMAT;
  version: typeof SCADA_SCREEN_TRANSFER_VERSION;
  exportedAt: string;
  screen: {
    name: string;
    description?: string;
    width: number;
    height: number;
    status?: string;
    widgets: unknown[];
    settings: Record<string, unknown>;
  };
  assets: ScadaScreenTransferAsset[];
}

const DROP_KEYS = new Set([
  'deviceid', 'deviceids', 'tag', 'tags', 'tagstatus', 'bindingdeviceid',
  'bindingtag', 'flowdeviceid', 'flowtag', 'statusdeviceid', 'statustag',
  'pointtag', 'readingdeviceid', 'readingtag',
  'setpointdeviceid', 'setpointtag', 'powerdeviceid', 'powertag',
  'groupid', 'componentid', 'targetscreenid', 'screenid', 'tenantid',
  'siteid', 'projectid', 'gatewayid', 'alarmid', 'alarmruleid',
  'alarmrule', 'pinnedtoproject',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDroppedReferenceKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (DROP_KEYS.has(normalized)) return true;
  return normalized.endsWith('deviceid') ||
    normalized.endsWith('deviceids') ||
    normalized.endsWith('tagstatus') ||
    normalized.endsWith('tag');
}

function assetSource(value: string): { kind: 'data' | 'storage'; value: string } | null {
  if (/^data:image\/[\w.+-]+;base64,/i.test(value)) return { kind: 'data', value };
  const match = /(?:https?:\/\/[^/]+)?\/scada-assets\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/.exec(value);
  return match ? { kind: 'storage', value: `${match[1]}/${match[2]}` } : null;
}

/**
 * Mantém a geometria e o estilo, mas remove toda referência de runtime.
 * Exportado para que o contrato de isolamento seja testável sem banco.
 */
export function sanitizeScadaScreenSnapshot(
  value: unknown,
  registerAsset?: (source: { kind: 'data' | 'storage'; value: string }) => string,
): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeScadaScreenSnapshot(item, registerAsset))
      // Listas que continham apenas deviceId/tag viram entradas vazias; elas
      // não são conteúdo visual. Pontos x/y de polígonos/tubulações continuam.
      .filter((item) => !isRecord(item) || Object.keys(item).length > 0);
  }
  if (typeof value === 'string') {
    const source = assetSource(value);
    return source && registerAsset ? `asset://${registerAsset(source)}` : value;
  }
  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isDroppedReferenceKey(key) || key === 'visibility' || key === 'status' || key === 'clickAction') continue;
    result[key] = sanitizeScadaScreenSnapshot(child, registerAsset);
  }
  return result;
}

function assertDimensions(width: unknown, height: unknown): { width: number; height: number } {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || w < 320 || w > 3840 || !Number.isInteger(h) || h < 240 || h > 2160) {
    throw new BadRequestException('Dimensões da tela visual inválidas');
  }
  return { width: w, height: h };
}

function safeContentType(value: unknown): string {
  if (typeof value !== 'string' || !/^image\/(?:png|jpeg|webp|svg\+xml|gif)$/i.test(value)) {
    throw new BadRequestException('Asset visual com tipo de imagem inválido');
  }
  return value.toLowerCase();
}

@Injectable()
export class ScadaScreenTransferService {
  constructor(
    private readonly assets: ScadaAssetService,
    private readonly storage: ScadaObjectStorageService,
    private readonly screens: ScadaService,
  ) {}

  async exportScreen(id: string, tenantId?: string): Promise<ScadaScreenTransferFile> {
    const screen = await this.screens.findOne(id, tenantId);
    const sources = new Map<string, { kind: 'data' | 'storage'; value: string }>();
    const registerAsset = (source: { kind: 'data' | 'storage'; value: string }) => {
      const key = `${source.kind}:${source.value}`;
      const existing = [...sources.entries()].find(([, current]) => `${current.kind}:${current.value}` === key);
      if (existing) return existing[0];
      const assetId = `asset-${sources.size + 1}`;
      sources.set(assetId, source);
      return assetId;
    };

    const widgets = sanitizeScadaScreenSnapshot(screen.widgets, registerAsset) as unknown[];
    const settings = sanitizeScadaScreenSnapshot(screen.settings, registerAsset) as Record<string, unknown>;
    const assets = await Promise.all([...sources.entries()].map(async ([id, source]) => {
      if (source.kind === 'data') {
        const comma = source.value.indexOf(',');
        return { id, dataUrl: source.value, contentType: source.value.slice(5, comma).split(';', 1)[0] };
      }
      const resolved = await this.storage.read(source.value);
      return {
        id,
        dataUrl: `data:${resolved.contentType};base64,${resolved.buffer.toString('base64')}`,
        contentType: resolved.contentType,
      };
    }));

    return {
      format: SCADA_SCREEN_TRANSFER_FORMAT,
      version: SCADA_SCREEN_TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      screen: {
        name: screen.name,
        ...(screen.description ? { description: screen.description } : {}),
        width: screen.width,
        height: screen.height,
        status: screen.status,
        widgets,
        settings,
      },
      assets,
    };
  }

  async importScreen(
    tenantId: string,
    siteId: string,
    projectId: string,
    payload: unknown,
  ) {
    if (!isRecord(payload) || payload.format !== SCADA_SCREEN_TRANSFER_FORMAT || payload.version !== SCADA_SCREEN_TRANSFER_VERSION) {
      throw new BadRequestException('Arquivo visual BlueBee inválido ou incompatível');
    }
    const rawScreen = payload.screen;
    if (!isRecord(rawScreen)) throw new BadRequestException('O arquivo visual não contém uma tela');
    const { width, height } = assertDimensions(rawScreen.width, rawScreen.height);
    const rawAssets = Array.isArray(payload.assets) ? payload.assets : [];
    const assetMap = new Map<string, string>();
    for (const rawAsset of rawAssets) {
      if (!isRecord(rawAsset) || typeof rawAsset.id !== 'string' || typeof rawAsset.dataUrl !== 'string') {
        throw new BadRequestException('Manifesto de imagens inválido');
      }
      const contentType = safeContentType(rawAsset.contentType);
      const match = new RegExp(`^data:${contentType.replace('+', '\\+')};base64,(.+)$`, 'i').exec(rawAsset.dataUrl);
      if (!match) throw new BadRequestException('Imagem do arquivo visual inválida');
      const saved = await this.assets.saveDataUrl(tenantId, rawAsset.dataUrl);
      assetMap.set(rawAsset.id, saved.url);
    }

    const materialize = async (value: unknown): Promise<unknown> => {
      if (Array.isArray(value)) return Promise.all(value.map(materialize));
      if (typeof value === 'string') {
        if (!value.startsWith('asset://')) return value;
        const resolved = assetMap.get(value.slice('asset://'.length));
        if (!resolved) throw new BadRequestException('A tela referencia uma imagem ausente no arquivo');
        return resolved;
      }
      if (!isRecord(value)) return value;
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        if (key === 'id') result[key] = randomUUID();
        else result[key] = await materialize(child);
      }
      return result;
    };

    const sanitized = sanitizeScadaScreenSnapshot(rawScreen);
    const widgets = await materialize(Array.isArray((sanitized as Record<string, unknown>).widgets)
      ? (sanitized as Record<string, unknown>).widgets
      : []);
    const settings = await materialize(isRecord((sanitized as Record<string, unknown>).settings)
      ? (sanitized as Record<string, unknown>).settings
      : {});
    const name = typeof rawScreen.name === 'string' && rawScreen.name.trim()
      ? rawScreen.name.trim()
      : 'Tela importada';
    const description = typeof rawScreen.description === 'string' ? rawScreen.description.trim() : undefined;
    return this.screens.create({
      name,
      description,
      tenantId,
      siteId,
      projectId,
      width,
      height,
      widgets: widgets as unknown[],
      settings: settings as Record<string, unknown>,
    });
  }
}