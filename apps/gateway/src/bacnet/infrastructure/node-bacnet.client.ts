import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { networkInterfaces } from 'os';
import { repairMojibake } from '../domain/mojibake-repair.util';

// node-bacnet usa UDP — não há conexão persistente TCP
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bacnet = require('node-bacnet');
// Módulos internos do node-bacnet — usados para decodificar o NPDU dos pacotes
// recebidos e extrair o "source" (net/adr) de dispositivos MS/TP atrás de
// roteadores BACnet. O client.js da lib decodifica esse campo mas o descarta,
// então interceptamos o transporte para capturá-lo nós mesmos.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const baBvlc = require('node-bacnet/lib/bvlc');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const baNpdu = require('node-bacnet/lib/npdu');

/**
 * Alvo BACnet endereçável. Para dispositivos BACnet/IP diretos, apenas
 * `address` (aceita "ip" ou "ip:porta"). Para dispositivos MS/TP atrás de um
 * roteador BACnet, `address` é o IP do ROTEADOR e net/adr identificam a rede
 * remota e o MAC do dispositivo naquela rede (vindos do I-Am roteado).
 */
export interface BacnetTarget {
  /** IP (ou "ip:porta") do dispositivo — ou do roteador BACnet quando net/adr presentes. */
  address: string;
  /** Número da rede BACnet remota (source.net do I-Am roteado). */
  net?: number | null;
  /** MAC do dispositivo na rede remota (source.adr do I-Am roteado, ex: [12] em MS/TP). */
  adr?: number[] | null;
}

/** Aceita string simples ("ip" ou "ip:porta") ou um BacnetTarget completo. */
export type BacnetDestination = string | BacnetTarget;

/** Rota de origem (net/adr) capturada do NPDU de um pacote recebido. */
interface NpduSourceRoute {
  net: number;
  adr: number[];
}

/**
 * Notificação COV (Change of Value) já normalizada a partir do evento cru do
 * node-bacnet (`covNotifyUnconfirmed` / `covNotify`).
 */
export interface BacnetCovNotification {
  /** IP de origem da notificação (sem porta). */
  address: string;
  /** subscriberProcessId — o mesmo id passado no subscribeCov (correlação). */
  subscribeId: number;
  /** Objeto monitorado que disparou a notificação. */
  monitoredObjectId: { type: number; instance: number };
  /** Propriedades notificadas (normalmente presentValue=85 e statusFlags=111). */
  values: Array<{
    property?: { id?: number; index?: number };
    value?: Array<{ value?: unknown }>;
  }>;
}

/**
 * Wrapper do cliente node-bacnet.
 *
 * node-bacnet opera sobre UDP/47808. Cada instância cria um socket UDP
 * que permanece aberto durante o ciclo de vida do módulo.
 *
 * Todas as operações de leitura/escrita usam Promise para integração
 * com o padrão async/await do NestJS.
 */
@Injectable()
export class NodeBacnetClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeBacnetClient.name);
  private client: ReturnType<typeof bacnet>;

  /**
   * Endereços de broadcast usados no Who-Is broadcast. Em hosts multi-homed
   * (Wi-Fi + Ethernet + adaptadores virtuais Hyper-V/WSL), não há como saber em
   * qual NIC a controladora está — então enviamos o Who-Is para o broadcast
   * dirigido de TODAS as subredes reais do host. As subredes sem controladora
   * simplesmente não respondem (custo zero).
   */
  private broadcastTargets: string[] = ['255.255.255.255'];

  /** Porta UDP local do socket BACnet (BACNET_PORT — padrão 47808). */
  private localPort = 47808;

  /**
   * Rota de origem (source net/adr) do ÚLTIMO pacote recebido pelo transporte.
   *
   * Como o Node processa cada datagrama UDP sincronamente (nosso listener
   * roda ANTES do listener interno do node-bacnet, via prependListener, e o
   * evento `iAm` é emitido na mesma pilha de chamadas), este campo permite
   * correlacionar cada I-Am com o net/adr do NPDU que o transportou — é assim
   * que capturamos o endereçamento de controladoras MS/TP atrás de roteadores
   * BACnet, que o client.js da lib decodifica mas descarta.
   */
  private lastNpduSource: NpduSourceRoute | null = null;

  onModuleInit(): void {
    // O default do node-bacnet (255.255.255.255 — broadcast limitado) frequentemente
    // NÃO chega à LAN física. O broadcast DIRIGIDO da subrede (ex: 192.168.0.255) é
    // roteado para todos os hosts daquela subrede e é o recomendado para BACnet.
    this.broadcastTargets = this.resolveBroadcastTargets();

    // interface de bind opcional (BACNET_INTERFACE) — útil em hosts multi-homed
    // para forçar o socket UDP a usar a NIC da rede BACnet.
    const iface = process.env.BACNET_INTERFACE?.trim() || undefined;

    // Porta UDP local configurável (BACNET_PORT) — permite operar em redes
    // onde 47808 está ocupada ou o site usa porta BACnet alternativa (47809+).
    const envPort = Number(process.env.BACNET_PORT?.trim() || '');
    this.localPort =
      Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : 47808;

    this.client = new bacnet({
      port: this.localPort,
      interface: iface,
      // broadcastAddress só é usado quando whoIs() é chamado sem endereço; no
      // scan enviamos explicitamente para cada alvo de broadcastTargets.
      broadcastAddress: this.broadcastTargets[0],
    });

    this.installNpduSourceCapture();

    this.logger.log(
      `Cliente node-bacnet inicializado (UDP ${this.localPort}` +
        `${iface ? `, interface=${iface}` : ''}` +
        `, broadcastTargets=[${this.broadcastTargets.join(', ')}])`,
    );
  }

  /**
   * Intercepta o transporte UDP do node-bacnet (prependListener) para decodificar
   * o NPDU de cada pacote recebido e capturar o campo "source" (net/adr) que a
   * lib descarta. Essencial para descobrir e endereçar controladoras MS/TP atrás
   * de roteadores BACnet: as respostas delas chegam com source.net/adr no NPDU,
   * e qualquer request subsequente precisa ecoar esses valores como destination.
   */
  private installNpduSourceCapture(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transport = (this.client as any)._transport;
    if (!transport || typeof transport.prependListener !== 'function') {
      this.logger.warn(
        'Transporte node-bacnet não expõe prependListener — captura de rota ' +
          'net/adr (MS/TP via roteador) desabilitada',
      );
      return;
    }

    transport.prependListener('message', (buffer: Buffer) => {
      // Reset a cada pacote — evita associar rota de um pacote anterior.
      this.lastNpduSource = null;
      try {
        if (!Buffer.isBuffer(buffer) || buffer.length < 4) return;
        const bvlc = baBvlc.decode(buffer, 0);
        if (!bvlc) return;
        // 10 = ORIGINAL_UNICAST_NPDU, 11 = ORIGINAL_BROADCAST_NPDU, 4 = FORWARDED_NPDU
        if (bvlc.func !== 10 && bvlc.func !== 11 && bvlc.func !== 4) return;
        const npdu = baNpdu.decode(buffer, bvlc.len);
        if (!npdu?.source) return;
        const { net, adr } = npdu.source as { net?: number; adr?: number[] };
        if (typeof net === 'number' && net > 0 && net !== 0xffff && Array.isArray(adr) && adr.length > 0) {
          this.lastNpduSource = { net, adr };
        }
      } catch {
        // Falha de decodificação não pode afetar o fluxo normal da lib.
      }
    });

    this.logger.log(
      'Captura de rota NPDU (source net/adr) ativa — suporte a controladoras ' +
        'MS/TP atrás de roteadores BACnet habilitado',
    );
  }

  /**
   * Converte um {@link BacnetDestination} no formato de receiver aceito pelo
   * node-bacnet: string simples para BACnet/IP direto, ou objeto
   * { address, net, adr } para dispositivos roteados (npdu.encode gera o
   * destination e o roteador encaminha para a rede MS/TP).
   */
  private toReceiver(
    dest: BacnetDestination,
  ): string | { address: string; net: number; adr: number[] } {
    if (typeof dest === 'string') return dest;
    if (
      typeof dest.net === 'number' &&
      dest.net > 0 &&
      Array.isArray(dest.adr) &&
      dest.adr.length > 0
    ) {
      return { address: dest.address, net: dest.net, adr: dest.adr };
    }
    return dest.address;
  }

  /** Rótulo legível de um destino para logs — "ip[:porta][ via net/adr]". */
  private destLabel(dest: BacnetDestination): string {
    if (typeof dest === 'string') return dest;
    const route =
      typeof dest.net === 'number' && dest.net > 0 && dest.adr?.length
        ? ` (net ${dest.net}, adr [${dest.adr.join(',')}])`
        : '';
    return `${dest.address}${route}`;
  }

  /**
   * Determina os endereços de broadcast a usar no Who-Is broadcast:
   *   1. BACNET_BROADCAST_ADDRESS (override explícito, aceita lista separada por
   *      vírgula) — sempre vence;
   *   2. broadcast dirigido de TODAS as interfaces IPv4 não-internas e não-APIPA
   *      (envia em todas as subredes reais — acha controladoras em qualquer NIC);
   *   3. fallback 255.255.255.255.
   *
   * Loga todas as interfaces candidatas para diagnóstico.
   */
  private resolveBroadcastTargets(): string[] {
    const override = process.env.BACNET_BROADCAST_ADDRESS?.trim();
    if (override) {
      const list = override
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      this.logger.log(`Broadcast BACnet definido via BACNET_BROADCAST_ADDRESS=[${list.join(', ')}]`);
      return list.length > 0 ? list : ['255.255.255.255'];
    }

    const candidates: Array<{ name: string; ip: string; broadcast: string }> = [];
    const ifaces = networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs ?? []) {
        // Node <18 expõe family como 'IPv4'; >=18 também aceita o número 4.
        const isIPv4 = addr.family === 'IPv4' || (addr.family as unknown) === 4;
        if (!isIPv4 || addr.internal) continue;
        // Ignora APIPA/link-local (169.254.x.x) — nunca há controladora útil lá.
        if (addr.address.startsWith('169.254.')) continue;
        const broadcast = this.computeDirectedBroadcast(addr.address, addr.netmask);
        // /32 e similares geram broadcast == próprio IP — não serve para descoberta.
        if (broadcast && broadcast !== addr.address) {
          candidates.push({ name, ip: addr.address, broadcast });
        }
      }
    }

    if (candidates.length === 0) {
      this.logger.warn(
        'Nenhuma interface IPv4 utilizável encontrada — usando broadcast limitado 255.255.255.255. ' +
          'Defina BACNET_BROADCAST_ADDRESS se o scan não encontrar controladoras.',
      );
      return ['255.255.255.255'];
    }

    this.logger.log(
      `Interfaces candidatas para broadcast BACnet: ${candidates
        .map((c) => `${c.name}(${c.ip} → ${c.broadcast})`)
        .join(', ')}`,
    );

    // Dedup de broadcasts iguais (ex: duas NICs na mesma subrede).
    const targets = Array.from(new Set(candidates.map((c) => c.broadcast)));
    this.logger.log(
      `Who-Is broadcast será enviado para ${targets.length} subrede(s): [${targets.join(', ')}]. ` +
        'Para restringir, defina BACNET_BROADCAST_ADDRESS (lista separada por vírgula).',
    );
    return targets;
  }

  /**
   * Calcula o endereço de broadcast dirigido de uma subrede a partir do IP e da
   * máscara: broadcast = (ip & mask) | ~mask. Ex: 192.168.1.42 / 255.255.255.0 → 192.168.1.255.
   */
  private computeDirectedBroadcast(ip: string, netmask: string): string | null {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);
    if (ipParts.length !== 4 || maskParts.length !== 4) return null;
    if (ipParts.some(Number.isNaN) || maskParts.some(Number.isNaN)) return null;
    const bcast = ipParts.map((octet, i) => (octet & maskParts[i]) | (~maskParts[i] & 0xff));
    return bcast.join('.');
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.close();
      this.logger.log('Cliente node-bacnet encerrado');
    }
  }

  /**
   * Lê uma propriedade de um objeto BACnet (ReadProperty — serviço 12).
   *
   * @param dest     IP ("ip" ou "ip:porta") ou BacnetTarget com net/adr (roteado)
   * @param objectId Identificador do objeto { type, instance }
   * @param property Código da propriedade (85=presentValue, 77=objectName, etc.)
   */
  readProperty(
    dest: BacnetDestination,
    objectId: { type: number; instance: number },
    property: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.client.readProperty(
        this.toReceiver(dest),
        objectId,
        property,
        (err: Error | null, value: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        },
      );
    });
  }

  /**
   * Lê múltiplas propriedades de múltiplos objetos em uma única
   * request BACnet (ReadPropertyMultiple — serviço 14).
   * Preferir este método para leituras em batch — reduz tráfego UDP.
   */
  readPropertyMultiple(
    dest: BacnetDestination,
    requestList: Array<{
      objectId: { type: number; instance: number };
      properties: Array<{ id: number }>;
    }>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.client.readPropertyMultiple(
        this.toReceiver(dest),
        requestList,
        (err: Error | null, value: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        },
      );
    });
  }

  /**
   * Versão segura de readPropertyMultiple — resolve `null` em caso de erro ou
   * timeout, sem lançar exceção. Usada no polling em batch: se a controladora
   * não suporta ReadPropertyMultiple (ou o APDU estoura), a camada superior
   * cai automaticamente para leitura individual.
   *
   * O node-bacnet NÃO retransmite quando o primeiro ACK se perde, então o
   * timeout manual evita que o callback fique pendurado indefinidamente.
   */
  async readPropertyMultipleSafe(
    dest: BacnetDestination,
    requestList: Array<{
      objectId: { type: number; instance: number };
      properties: Array<{ id: number }>;
    }>,
    timeoutMs = 3000,
  ): Promise<unknown | null> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
      this.client.readPropertyMultiple(
        this.toReceiver(dest),
        requestList,
        (err: Error | null, value: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) resolve(null);
          else resolve(value);
        },
      );
    });
  }

  /**
   * Assina COV (Change of Value — serviço 5) de um objeto, de forma segura:
   * resolve `true` no SimpleACK, `false` em erro/timeout (a camada superior cai
   * para polling). `subscribeId` (subscriberProcessId) identifica a assinatura e
   * deve ser reutilizado nas renovações do mesmo objeto.
   *
   * Usamos notificações NÃO confirmadas (issueConfirmedNotifications=false) —
   * o device envia UnconfirmedCOVNotification, entregue pelo evento
   * `covNotifyUnconfirmed`. `lifetimeSeconds` é o tempo de vida da assinatura no
   * device (0 = permanente, mas preferimos um valor finito + renovação).
   */
  async subscribeCovSafe(
    dest: BacnetDestination,
    objectId: { type: number; instance: number },
    subscribeId: number,
    lifetimeSeconds: number,
    timeoutMs = 3000,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      try {
        this.client.subscribeCov(
          this.toReceiver(dest),
          objectId,
          subscribeId,
          false, // cancel
          false, // issueConfirmedNotifications → notificações não confirmadas
          lifetimeSeconds,
          {},
          (err: Error | null) => finish(!err),
        );
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Cancela uma assinatura COV (subscribeCov com cancel=true). Best-effort:
   * resolve mesmo em erro/timeout — usado no reload de config e no shutdown.
   */
  async cancelCovSafe(
    dest: BacnetDestination,
    objectId: { type: number; instance: number },
    subscribeId: number,
    timeoutMs = 2000,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      try {
        this.client.subscribeCov(
          this.toReceiver(dest),
          objectId,
          subscribeId,
          true, // cancel
          false,
          0,
          {},
          () => {
            clearTimeout(timer);
            done();
          },
        );
      } catch {
        clearTimeout(timer);
        done();
      }
    });
  }

  /**
   * Registra um handler para notificações COV recebidas (confirmadas e não
   * confirmadas), normalizando o payload cru do node-bacnet em
   * {@link BacnetCovNotification}. Deve ser chamado uma vez, na inicialização.
   */
  onCovNotification(handler: (notification: BacnetCovNotification) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrap = (content: any) => {
      try {
        const payload = content?.payload;
        if (!payload || typeof payload.subscriberProcessId !== 'number') {
          return;
        }
        const rawAddress: string =
          content?.header?.sender?.address ?? content?.address ?? '';
        handler({
          address: String(rawAddress).split(':')[0],
          subscribeId: payload.subscriberProcessId,
          monitoredObjectId: {
            type: payload.monitoredObjectId?.type,
            instance: payload.monitoredObjectId?.instance,
          },
          values: Array.isArray(payload.values) ? payload.values : [],
        });
      } catch (err) {
        this.logger.warn(
          `Falha ao processar notificação COV: ${(err as Error).message}`,
        );
      }
    };
    this.client.on('covNotifyUnconfirmed', wrap);
    this.client.on('covNotify', wrap);
  }

  /**
   * Escreve em uma propriedade de um objeto BACnet (WriteProperty — serviço 15).
   * Para AO/BO: sempre informar priority (8=Manual_Operator, 16=automação).
   * Para relinquish: passar value=null no mesmo nível de prioridade.
   *
   * `timeoutMs` (opcional): rejeita com um erro claro se o SimpleACK não
   * chegar nesse prazo. O node-bacnet NÃO retransmite quando o primeiro ACK
   * se perde (típico em device "frio" durante o ARP/address-binding inicial):
   * sem este timeout o callback fica pendurado indefinidamente. Com ele, a
   * camada superior pode reenviar a mesma escrita idempotente.
   */
  writeProperty(
    dest: BacnetDestination,
    objectId: { type: number; instance: number },
    property: number,
    value: Array<{ type: number; value: unknown }>,
    priority?: number,
    timeoutMs?: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const settle = (err?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          settle(
            new Error(
              `WriteProperty confirmation not received in ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }

      this.client.writeProperty(
        this.toReceiver(dest),
        objectId,
        property,
        value,
        { priority },
        (err: Error | null) => {
          settle(err ?? undefined);
        },
      );
    });
  }

  /**
   * Versão segura de readProperty — retorna null em caso de erro ou timeout,
   * sem lançar exceção. Ideal para enumeração onde "não existe" é esperado.
   */
  async readPropertySafe(
    dest: BacnetDestination,
    objectId: { type: number; instance: number },
    property: number,
    timeoutMs = 3000,
  ): Promise<unknown | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      this.client.readProperty(
        this.toReceiver(dest),
        objectId,
        property,
        (err: Error | null, value: unknown) => {
          clearTimeout(timer);
          if (err) resolve(null);
          else resolve(value);
        },
      );
    });
  }

  /**
   * Lê UM índice de uma propriedade array (ReadProperty com arrayIndex).
   * Usado no fallback índice-a-índice do objectList (property 76): índice 0 é
   * o COUNT do array; índices 1..N são os ObjectIdentifiers individuais.
   * Essencial para controladoras cujo objectList completo estoura o APDU e
   * que não suportam segmentação. Retorna null em erro/timeout.
   */
  async readPropertyIndexSafe(
    dest: BacnetDestination,
    objectId: { type: number; instance: number },
    property: number,
    arrayIndex: number,
    timeoutMs = 3000,
  ): Promise<unknown | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      this.client.readProperty(
        this.toReceiver(dest),
        objectId,
        property,
        { arrayIndex },
        (err: Error | null, value: unknown) => {
          clearTimeout(timer);
          if (err) resolve(null);
          else resolve(value);
        },
      );
    });
  }

  /**
   * Envia Who-Is unicast para um IP específico e aguarda o I-Am de resposta.
   * Retorna a instância do dispositivo BACnet descoberta automaticamente.
   *
   * @param address IP do dispositivo
   * @param timeoutMs Tempo máximo de espera (padrão: 5s)
   */
  whoIs(
    address: string,
    timeoutMs = 5000,
  ): Promise<{ instance: number; net: number | null; adr: number[] | null }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.removeListener('iAm', handler);
        reject(new Error(`Who-Is timeout — nenhum dispositivo BACnet respondeu em ${address}`));
      }, timeoutMs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (device: any) => {
        // Filtra apenas respostas do IP solicitado (com ou sem porta).
        const deviceAddress: string =
          device?.header?.sender?.address ??
          device?.address ??
          '';
        if (!this.sameHost(deviceAddress, address)) return;

        clearTimeout(timer);
        this.client.removeListener('iAm', handler);
        // device.payload.deviceId é um número puro em node-bacnet v0.2.x,
        // não um objeto com .instance — extrair diretamente.
        const instance: number =
          typeof device?.payload?.deviceId === 'number'
            ? (device.payload.deviceId as number)
            : 0;
        // lastNpduSource foi setado sincronamente pelo interceptor do transporte
        // para ESTE pacote — presente apenas quando o I-Am veio roteado (MS/TP).
        const route = this.lastNpduSource;
        this.logger.debug(
          `I-Am recebido de ${address} — device instance: ${instance}` +
            (route ? ` (roteado: net=${route.net}, adr=[${route.adr.join(',')}])` : ''),
        );
        resolve({
          instance,
          net: route?.net ?? null,
          adr: route?.adr ?? null,
        });
      };

      this.client.on('iAm', handler);

      // Envia Who-Is unicast para o IP específico (aceita "ip" ou "ip:porta")
      this.client.whoIs({ address });
      this.logger.debug(`Who-Is enviado para ${address}`);
    });
  }

  /**
   * Compara dois endereços "ip" ou "ip:porta" ignorando a porta padrão 47808.
   * Evita match parcial entre IPs como "10.0.0.1" e "10.0.0.10" e trata a
   * assimetria do node-bacnet, que omite ":47808" nos endereços recebidos.
   */
  private sameHost(a: string, b: string): boolean {
    const normalize = (s: string): string => {
      const trimmed = s.trim();
      return trimmed.endsWith(':47808') ? trimmed.slice(0, -6) : trimmed;
    };
    return normalize(a) === normalize(b);
  }

  /**
   * Envia Who-Is broadcast e coleta todas as respostas I-Am durante um período
   * fixo. Usado para descobrir todas as controladoras BACnet da rede local sem
   * que o usuário precise informar o IP de cada uma.
   *
   * Deduplica por instance+endereço+rota — a mesma controladora respondendo
   * mais de uma vez (comum em broadcast) é mantida só na primeira resposta,
   * mas devices distintos com a MESMA instance em IPs/redes diferentes (comum
   * entre fabricantes que saem de fábrica com instance padrão) são preservados.
   *
   * Captura também o source net/adr do NPDU — controladoras MS/TP atrás de um
   * roteador BACnet respondem com o IP do ROTEADOR e net/adr identificando o
   * device na rede remota.
   *
   * @param timeoutMs Janela de captura de respostas I-Am (padrão: 10s)
   */
  whoIsBroadcast(
    timeoutMs = 10000,
  ): Promise<
    Array<{
      instance: number;
      address: string;
      vendorId: number | null;
      net: number | null;
      adr: number[] | null;
    }>
  > {
    return new Promise((resolve) => {
      const found = new Map<
        string,
        {
          instance: number;
          address: string;
          vendorId: number | null;
          net: number | null;
          adr: number[] | null;
        }
      >();
      let rawLogged = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (device: any) => {
        // Diagnóstico: na primeira resposta, loga a estrutura crua do I-Am para
        // confirmar o formato real do node-bacnet neste ambiente.
        if (!rawLogged) {
          rawLogged = true;
          try {
            this.logger.log(
              `I-Am (broadcast) — payload cru da 1ª resposta: ${JSON.stringify(device).slice(0, 500)}`,
            );
          } catch {
            this.logger.log('I-Am (broadcast) — 1ª resposta recebida (payload não serializável)');
          }
        }

        // Rota NPDU deste pacote — setada sincronamente pelo interceptor do
        // transporte ANTES do node-bacnet emitir o iAm (mesma pilha de chamadas).
        const route = this.lastNpduSource;

        const rawAddress: string =
          device?.header?.sender?.address ??
          device?.address ??
          '';
        // Normaliza apenas a porta padrão (":47808" → removida) — porta
        // NÃO-padrão é preservada para endereçar o device corretamente.
        const address = rawAddress.endsWith(':47808')
          ? rawAddress.slice(0, -6)
          : rawAddress;

        // deviceId é número puro no node-bacnet v0.2.x, mas algumas builds
        // expõem como objeto { instance } — aceitar ambos por robustez.
        const rawDeviceId: unknown = device?.payload?.deviceId;
        const instance: number =
          typeof rawDeviceId === 'number'
            ? rawDeviceId
            : typeof (rawDeviceId as { instance?: unknown })?.instance === 'number'
              ? ((rawDeviceId as { instance: number }).instance)
              : 0;

        const vendorId: number | null =
          typeof device?.payload?.vendorId === 'number'
            ? (device.payload.vendorId as number)
            : null;

        if (!address || !instance) {
          this.logger.warn(
            `I-Am (broadcast) ignorado — address="${address}" instance=${instance} ` +
              '(formato inesperado ou device instance 0)',
          );
          return;
        }

        // Dedupe por instance + endereço + rota (net/adr) — preserva devices
        // distintos com a mesma instance em redes/IPs diferentes.
        const routeKey = route ? `${route.net}/${route.adr.join('.')}` : '';
        const key = `${instance}@${address}#${routeKey}`;
        if (!found.has(key)) {
          found.set(key, {
            instance,
            address,
            vendorId,
            net: route?.net ?? null,
            adr: route?.adr ?? null,
          });
          this.logger.log(
            `I-Am (broadcast) recebido — device ${instance} em ${address}` +
              (route ? ` (roteado: net=${route.net}, adr=[${route.adr.join(',')}])` : ''),
          );
        }
      };

      this.client.on('iAm', handler);

      // Envia um Who-Is dirigido para cada subrede real do host. Como o socket
      // está em 0.0.0.0, o SO roteia cada broadcast dirigido pela NIC correta —
      // assim a controladora é alcançada esteja ela em qualquer interface.
      for (const target of this.broadcastTargets) {
        this.client.whoIs(target);
        this.logger.log(`Who-Is enviado para ${target}`);
      }
      this.logger.log(
        `Who-Is broadcast enviado para ${this.broadcastTargets.length} subrede(s) — ` +
          `aguardando respostas por ${timeoutMs}ms`,
      );

      setTimeout(() => {
        this.client.removeListener('iAm', handler);
        if (found.size === 0) {
          this.logger.warn(
            `Who-Is broadcast: nenhuma resposta I-Am em ${timeoutMs}ms ` +
              `(targets=[${this.broadcastTargets.join(', ')}]). ` +
              'Possíveis causas: a controladora não está em nenhuma dessas subredes ' +
              '(ajuste BACNET_BROADCAST_ADDRESS), firewall do host bloqueando UDP 47808, ' +
              'ou a controladora não responde a Who-Is broadcast. Dica: rode o gateway ' +
              'com DEBUG=bacnet:* para inspecionar o tráfego UDP cru.',
          );
        }
        resolve(Array.from(found.values()));
      }, timeoutMs);
    });
  }

  /**
   * Lê vendorName (121), modelName (70) e objectName (77) do Device Object
   * de uma controladora — usado para identificar a controladora encontrada
   * via Who-Is broadcast (modelo/fabricante) sem precisar do objectList completo.
   *
   * Cada leitura é independente e usa readPropertySafe — falha em uma
   * propriedade não impede as demais.
   */
  async readDeviceInfo(
    dest: BacnetDestination,
    instance: number,
    timeoutMs = 2000,
  ): Promise<{ vendorName: string | null; modelName: string | null; objectName: string | null }> {
    const [vendorRaw, modelRaw, nameRaw] = await Promise.all([
      this.readPropertySafe(dest, { type: 8, instance }, 121, timeoutMs), // vendorName
      this.readPropertySafe(dest, { type: 8, instance }, 70, timeoutMs),  // modelName
      this.readPropertySafe(dest, { type: 8, instance }, 77, timeoutMs),  // objectName
    ]);

    return {
      vendorName: this.extractStringValue(vendorRaw),
      modelName: this.extractStringValue(modelRaw),
      objectName: this.extractStringValue(nameRaw),
    };
  }

  /**
   * Extrai o valor string de uma resposta ReadProperty.
   * node-bacnet v0.2.x retorna: { values: [{ type: 7, value: 'Texto' }] }
   */
  private extractStringValue(raw: unknown): string | null {
    try {
      const response = raw as { values?: Array<{ value?: unknown }> };
      const val = response?.values?.[0]?.value;
      if (typeof val === 'string' && val.trim() !== '') return repairMojibake(val.trim());
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai um valor numérico de uma resposta ReadProperty (ex: vendorIdentifier).
   * node-bacnet retorna: { values: [{ type: 2, value: 42 }] }
   */
  private extractNumberValue(raw: unknown): number | null {
    try {
      const response = raw as { values?: Array<{ value?: unknown }> };
      const val = response?.values?.[0]?.value;
      if (typeof val === 'number') return val;
      if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
        return Number(val);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai a instância do Device Object de uma resposta de objectIdentifier (prop 75).
   * node-bacnet retorna: { values: [{ type: 12, value: { type: 8, instance: 11 } }] }
   */
  private extractObjectInstance(raw: unknown): number | null {
    try {
      const response = raw as {
        values?: Array<{ value?: { type?: number; instance?: number } | number }>;
      };
      const val = response?.values?.[0]?.value;
      if (val && typeof val === 'object' && typeof val.instance === 'number') {
        return val.instance;
      }
      if (typeof val === 'number') return val;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Sonda um IP via leitura UNICAST do Device Object (instância coringa 4194303)
   * e, se responder, lê nome/modelo/fabricante. Usado pela varredura de rede
   * (scan unicast) para descobrir controladoras que NÃO respondem a Who-Is — como
   * a MCP46D (firmware Climate), que ignora Who-Is mas responde readProperty.
   *
   * Retorna null quando o IP não responde (host inexistente ou não-BACnet) —
   * a varredura simplesmente ignora esses.
   *
   * @param address IP a sondar (aceita "ip" ou "ip:porta")
   * @param timeoutMs timeout por leitura (curto, pois a maioria dos IPs não responde)
   */
  async probeDeviceObject(
    address: string,
    timeoutMs = 700,
  ): Promise<{
    instance: number;
    address: string;
    vendorId: number | null;
    vendorName: string | null;
    modelName: string | null;
    objectName: string | null;
  } | null> {
    // 4194303 (0x3FFFFF) = instância coringa "este dispositivo" — permite
    // identificar o Device Object sem conhecer a instância real de antemão.
    const WILDCARD_INSTANCE = 4194303;

    const idRaw = await this.readPropertySafe(
      address,
      { type: 8, instance: WILDCARD_INSTANCE },
      75, // objectIdentifier
      timeoutMs,
    );

    const instance = this.extractObjectInstance(idRaw);
    if (instance === null) {
      // Sem resposta válida — não é uma controladora BACnet/IP acessível.
      return null;
    }

    // Lê detalhes usando a instância REAL (mais confiável que a coringa).
    const [nameRaw, modelRaw, vendorNameRaw, vendorIdRaw] = await Promise.all([
      this.readPropertySafe(address, { type: 8, instance }, 77, timeoutMs),  // objectName
      this.readPropertySafe(address, { type: 8, instance }, 70, timeoutMs),  // modelName
      this.readPropertySafe(address, { type: 8, instance }, 121, timeoutMs), // vendorName
      this.readPropertySafe(address, { type: 8, instance }, 120, timeoutMs), // vendorIdentifier
    ]);

    return {
      instance,
      address,
      vendorId: this.extractNumberValue(vendorIdRaw),
      vendorName: this.extractStringValue(vendorNameRaw),
      modelName: this.extractStringValue(modelRaw),
      objectName: this.extractStringValue(nameRaw),
    };
  }

  /**
   * Enumera os IPs a sondar na varredura de rede unicast:
   *   1. BACNET_SCAN_SUBNETS (override, lista de CIDRs separada por vírgula) — vence;
   *   2. todas as subredes IPv4 não-internas e não-APIPA do host, com no máximo
   *      ~1022 hosts (prefixo >= /22) — exclui adaptadores virtuais grandes
   *      (Hyper-V/WSL /20) e /32 sem subrede.
   *
   * Exclui endereço de rede, de broadcast e o próprio IP do host. Limita o total
   * para evitar varreduras gigantes.
   */
  getScanTargets(): string[] {
    const MAX_TARGETS = 4096;
    const subnets: Array<{ net: number; mask: number; ownIp: number; label: string }> = [];

    // Alvos individuais "ip" ou "ip:porta" declarados em BACNET_SCAN_SUBNETS —
    // permitem sondar controladoras em porta BACnet não-padrão (ex: 10.0.0.5:47809).
    const explicitTargets: string[] = [];

    const override = process.env.BACNET_SCAN_SUBNETS?.trim();
    if (override) {
      for (const entry of override.split(',').map((s) => s.trim()).filter(Boolean)) {
        // Entrada com porta explícita ou sem prefixo CIDR → alvo individual.
        if (!entry.includes('/')) {
          const [ipPart, portPart] = entry.split(':');
          const ipInt = this.ipToInt(ipPart);
          if (ipInt === null) continue;
          const port = portPart !== undefined ? Number(portPart) : null;
          if (port !== null && (!Number.isInteger(port) || port <= 0 || port > 65535)) continue;
          explicitTargets.push(port !== null && port !== 47808 ? `${ipPart}:${port}` : ipPart);
          continue;
        }
        const [base, pfxStr] = entry.split('/');
        const pfx = Number(pfxStr ?? '24');
        if (Number.isNaN(pfx) || pfx < 0 || pfx > 32) continue;
        const mask = pfx === 0 ? 0 : ((0xffffffff << (32 - pfx)) >>> 0);
        const baseInt = this.ipToInt(base);
        if (baseInt === null) continue;
        subnets.push({ net: (baseInt & mask) >>> 0, mask, ownIp: -1, label: entry });
      }
      this.logger.log(`Varredura unicast restrita por BACNET_SCAN_SUBNETS=[${override}]`);
    } else {
      const ifaces = networkInterfaces();
      for (const [name, addrs] of Object.entries(ifaces)) {
        for (const addr of addrs ?? []) {
          const isIPv4 = addr.family === 'IPv4' || (addr.family as unknown) === 4;
          if (!isIPv4 || addr.internal) continue;
          if (addr.address.startsWith('169.254.')) continue;
          const ownIp = this.ipToInt(addr.address);
          const mask = this.ipToInt(addr.netmask);
          if (ownIp === null || mask === null) continue;
          const hostBits = 32 - this.maskToPrefix(mask);
          // Pula /32 (sem subrede) e subredes maiores que /22 (>1022 hosts) — os
          // adaptadores virtuais Hyper-V/WSL são /20 e seriam varreduras enormes.
          if (hostBits < 1 || hostBits > 10) continue;
          subnets.push({ net: (ownIp & mask) >>> 0, mask, ownIp, label: name });
        }
      }
    }

    const targets: string[] = [...new Set(explicitTargets)];
    const seen = new Set<number>();
    for (const { net, mask, ownIp } of subnets) {
      const broadcast = (net | (~mask >>> 0)) >>> 0;
      for (let h = (net + 1) >>> 0; h < broadcast; h = (h + 1) >>> 0) {
        if (h === ownIp || seen.has(h)) continue;
        seen.add(h);
        targets.push(this.intToIp(h));
        if (targets.length >= MAX_TARGETS) {
          this.logger.warn(`Varredura limitada a ${MAX_TARGETS} IPs — subredes muito grandes.`);
          return targets;
        }
      }
    }
    return targets;
  }

  /** Converte "a.b.c.d" para inteiro 32-bit não-sinalizado; null se inválido. */
  private ipToInt(ip: string): number | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  /** Converte inteiro 32-bit não-sinalizado para "a.b.c.d". */
  private intToIp(n: number): string {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  /** Conta os bits 1 de uma máscara (inteiro 32-bit) → comprimento do prefixo. */
  private maskToPrefix(mask: number): number {
    let count = 0;
    let m = mask >>> 0;
    while (m) {
      count += m & 1;
      m >>>= 1;
    }
    return count;
  }

  /**
   * Expõe o cliente bruto para uso em casos especiais (COV, etc.)
   */
  getRawClient(): ReturnType<typeof bacnet> {
    return this.client;
  }
}
