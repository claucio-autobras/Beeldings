import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Envelope de resposta paginada da API Infraspeak.
 *
 * Estrutura confirmada na documentação oficial (página "Pagination"):
 * https://infraspeak.stoplight.io/docs/api/7d56ca7f2fd57-pagination
 *
 *   {
 *     "data": [ ... ],
 *     "meta": { "pagination": { "per_page": 200, "current_page": 3 } },
 *     "links": { "self": "...", "first": "...", "prev": "...", "next": "..." }
 *   }
 */
export interface InfraspeakPaginatedResponse<T = unknown> {
  data: T[];
  meta?: {
    pagination?: {
      per_page?: number;
      current_page?: number;
    };
  };
  links?: {
    self?: string;
    first?: string;
    prev?: string;
    next?: string;
  };
}

export type InfraspeakQuery = Record<string, string | number | undefined>;

interface RequestOptions {
  query?: InfraspeakQuery;
}

type RetryableKind = 'rate_limit' | 'server' | 'timeout' | 'network';

/**
 * Erro interno usado para sinalizar falhas que podem ser repetidas (retry).
 * Após esgotar as tentativas, é convertido na exceção HTTP apropriada.
 */
class RetryableError extends Error {
  constructor(
    message: string,
    readonly kind: RetryableKind,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }

  toHttpException(): HttpException {
    switch (this.kind) {
      case 'rate_limit':
        return new HttpException(
          `Infraspeak indisponível por rate limit: ${this.message}`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'timeout':
        return new GatewayTimeoutException(`Infraspeak: ${this.message}`);
      case 'server':
      case 'network':
      default:
        return new ServiceUnavailableException(`Infraspeak indisponível: ${this.message}`);
    }
  }
}

/**
 * Camada ÚNICA de integração com a API REST da Infraspeak.
 *
 * Responsável por: autenticação, headers, paginação, tratamento de erros,
 * rate limit, logs e retries. Todo comportamento implementado aqui é baseado
 * exclusivamente na documentação oficial — ver `docs/infraspeak-requirements-api.md`.
 *
 * Configuração (apenas variáveis de ambiente):
 *   INFRASPEAK_API_BASE_URL  — URL base da API (ex.: confirmar host na conta/portal)
 *   INFRASPEAK_API_TOKEN     — Personal Access Token (PAT) Bearer
 *   INFRASPEAK_USER_AGENT    — (opcional) identificação da aplicação
 *   INFRASPEAK_TIMEOUT_MS    — (opcional) timeout por requisição (padrão 15000)
 *   INFRASPEAK_MAX_RETRIES   — (opcional) nº de retries em 429/5xx/timeout (padrão 3)
 *   INFRASPEAK_PAGE_LIMIT    — (opcional) itens por página (padrão 200, conf. doc)
 *   INFRASPEAK_MAX_PAGES     — (opcional) guarda anti-loop de paginação (padrão 1000)
 */
@Injectable()
export class InfraspeakClient {
  private readonly logger = new Logger(InfraspeakClient.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly defaultLimit: number;
  private readonly maxPages: number;

  /** Teto de espera entre retries para não bloquear indefinidamente (ms). */
  private static readonly MAX_RETRY_DELAY_MS = 60_000;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (config.get<string>('INFRASPEAK_API_BASE_URL') ?? '').replace(/\/+$/, '');
    this.token = config.get<string>('INFRASPEAK_API_TOKEN') ?? '';
    this.userAgent = config.get<string>('INFRASPEAK_USER_AGENT') ?? 'Bluebee-IoT Infraspeak Integration';
    this.timeoutMs = this.numberFromConfig('INFRASPEAK_TIMEOUT_MS', 15_000);
    this.maxRetries = this.numberFromConfig('INFRASPEAK_MAX_RETRIES', 3);
    this.defaultLimit = this.numberFromConfig('INFRASPEAK_PAGE_LIMIT', 200);
    this.maxPages = this.numberFromConfig('INFRASPEAK_MAX_PAGES', 1000);
  }

  /**
   * Busca uma única página de um recurso.
   */
  async get<T = unknown>(
    resourcePath: string,
    options: RequestOptions = {},
  ): Promise<InfraspeakPaginatedResponse<T>> {
    this.assertConfigured();
    const url = this.buildUrl(resourcePath, options.query);
    return this.requestWithRetry<T>(url);
  }

  /**
   * Percorre automaticamente todas as páginas de um recurso e consolida o
   * conteúdo de `data` em uma única coleção.
   *
   * A existência de mais páginas é detectada por `links.next` (conforme doc).
   */
  async getAll<T = unknown>(
    resourcePath: string,
    options: RequestOptions = {},
  ): Promise<{ data: T[]; pages: number }> {
    this.assertConfigured();

    const limit = this.resolveLimit(options.query?.limit);
    const collected: T[] = [];
    let page = 1;
    let pages = 0;

    while (page <= this.maxPages) {
      const response = await this.get<T>(resourcePath, {
        query: { ...options.query, limit, page },
      });

      const items = Array.isArray(response.data) ? response.data : [];
      collected.push(...items);
      pages = page;

      const hasNext = Boolean(response.links?.next);
      if (!hasNext || items.length === 0) break;
      page += 1;
    }

    if (page > this.maxPages) {
      this.logger.warn(
        `Infraspeak: limite de ${this.maxPages} páginas atingido em "${resourcePath}"; ` +
          'o resultado pode estar truncado. Ajuste INFRASPEAK_MAX_PAGES se necessário.',
      );
    }

    return { data: collected, pages };
  }

  private resolveLimit(raw: string | number | undefined): number {
    if (raw === undefined) return this.defaultLimit;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : this.defaultLimit;
  }

  private numberFromConfig(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private assertConfigured(): void {
    if (!this.baseUrl || !this.token) {
      throw new ServiceUnavailableException(
        'Integração Infraspeak não configurada: defina INFRASPEAK_API_BASE_URL e ' +
          'INFRASPEAK_API_TOKEN nas variáveis de ambiente.',
      );
    }
  }

  private buildUrl(resourcePath: string, query?: InfraspeakQuery): string {
    const path = resourcePath.replace(/^\/+/, '');
    const url = new URL(`${this.baseUrl}/${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async requestWithRetry<T>(url: string): Promise<InfraspeakPaginatedResponse<T>> {
    let attempt = 0;

    // Total de tentativas = maxRetries + 1 (a inicial).
    while (true) {
      attempt += 1;
      try {
        return await this.doRequest<T>(url);
      } catch (err) {
        if (err instanceof RetryableError && attempt <= this.maxRetries) {
          const delayMs = Math.min(
            err.retryAfterMs ?? this.backoffMs(attempt),
            InfraspeakClient.MAX_RETRY_DELAY_MS,
          );
          this.logger.warn(
            `Infraspeak: tentativa ${attempt}/${this.maxRetries + 1} falhou ` +
              `(${err.kind}: ${err.message}); novo retry em ${delayMs}ms`,
          );
          await this.sleep(delayMs);
          continue;
        }

        if (err instanceof RetryableError) {
          this.logger.error(`Infraspeak: falha após ${attempt} tentativa(s) — ${err.message}`);
          throw err.toHttpException();
        }

        throw err;
      }
    }
  }

  private async doRequest<T>(url: string): Promise<InfraspeakPaginatedResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new RetryableError(`timeout após ${this.timeoutMs}ms`, 'timeout');
      }
      throw new RetryableError(`falha de rede: ${(err as Error).message}`, 'network');
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      return this.parseBody<T>(res);
    }

    return this.handleErrorStatus(res);
  }

  private async parseBody<T>(res: Response): Promise<InfraspeakPaginatedResponse<T>> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new BadGatewayException('Infraspeak retornou uma resposta não-JSON ou com corpo inválido.');
    }

    if (
      body === null ||
      typeof body !== 'object' ||
      !Array.isArray((body as Record<string, unknown>).data)
    ) {
      throw new BadGatewayException(
        'Infraspeak retornou um formato de resposta inesperado (campo "data" ausente ou inválido).',
      );
    }

    return body as InfraspeakPaginatedResponse<T>;
  }

  /**
   * Mapeia os códigos HTTP de erro documentados oficialmente
   * (https://infraspeak.stoplight.io/docs/api/be910e4a766ea-errors) para
   * exceções do NestJS. Códigos 429 e 5xx são marcados como "retryable".
   */
  private async handleErrorStatus(res: Response): Promise<never> {
    const bodyText = await res.text().catch(() => '');
    const message = this.extractMessage(bodyText) ?? res.statusText;

    switch (res.status) {
      case 400:
        throw new BadRequestException(`Infraspeak 400 (validação/parâmetros): ${message}`);
      case 401:
        throw new UnauthorizedException(
          `Infraspeak 401: autenticação inválida, ausente ou token revogado. ${message}`,
        );
      case 404:
        throw new NotFoundException(`Infraspeak 404: recurso ou endpoint inexistente. ${message}`);
      case 405:
        throw new MethodNotAllowedException(`Infraspeak 405: método HTTP não permitido. ${message}`);
      case 429:
        throw new RetryableError(`rate limit excedido: ${message}`, 'rate_limit', this.parseRetryAfter(res));
      default:
        if (res.status >= 500) {
          throw new RetryableError(`erro do servidor Infraspeak (HTTP ${res.status}): ${message}`, 'server');
        }
        throw new HttpException(
          `Infraspeak respondeu HTTP ${res.status}: ${message}`,
          HttpStatus.BAD_GATEWAY,
        );
    }
  }

  /**
   * Calcula o tempo de espera ao receber 429, conforme documentação oficial:
   * header `Retry-After` (em segundos) ou, em alternativa, `X-RateLimit-Reset`
   * (UNIX timestamp). Ver `docs/infraspeak-requirements-api.md`, secção Rate Limit.
   */
  private parseRetryAfter(res: Response): number | undefined {
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }

    const reset = res.headers.get('X-RateLimit-Reset');
    if (reset) {
      const resetUnix = Number(reset);
      if (Number.isFinite(resetUnix)) {
        const deltaMs = resetUnix * 1000 - Date.now();
        if (deltaMs > 0) return deltaMs;
      }
    }

    return undefined;
  }

  private extractMessage(bodyText: string): string | undefined {
    if (!bodyText) return undefined;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: { message?: string };
        message?: string;
      };
      return parsed?.error?.message ?? parsed?.message ?? undefined;
    } catch {
      return bodyText.slice(0, 500);
    }
  }

  /** Backoff exponencial com jitter. */
  private backoffMs(attempt: number): number {
    const base = 500 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
