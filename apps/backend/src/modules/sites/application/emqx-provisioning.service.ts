import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmqxProvisioningService {
  private readonly logger = new Logger(EmqxProvisioningService.name);
  private readonly apiUrl: string | undefined;
  private readonly authHeader: string;
  /** Garante que a fonte de autorização built_in_database só seja checada uma vez. */
  private aclSourceEnsured = false;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get<string>('EMQX_API_URL');
    // EMQX 5.x usa API Keys (key_id:key_secret), não username/password do dashboard
    const key = config.get<string>('EMQX_API_KEY', '');
    const secret = config.get<string>('EMQX_API_SECRET', '');
    this.authHeader = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  }

  /**
   * Cria o usuário MQTT e as regras ACL no EMQX para o gateway provisionado.
   * Se EMQX_API_URL não estiver configurado, emite um aviso e retorna sem erro
   * (compatibilidade com ambientes sem EMQX gerenciado).
   */
  async provisionGateway(gatewayId: string, password: string, tenantId: string): Promise<void> {
    if (!this.apiUrl) {
      this.logger.warn(
        `EMQX_API_URL não configurado — gateway ${gatewayId} criado no banco sem provisionamento MQTT. ` +
        'Configure EMQX_API_URL para ativar isolamento por tenant.',
      );
      return;
    }

    await this.createMqttUser(gatewayId, password);
    await this.createAclRules(gatewayId, tenantId);
  }

  /**
   * Remove o usuário MQTT e as regras ACL do EMQX ao excluir o gateway/site.
   * Também remove o usuário dedicado de sensores e, quando o tenantId é
   * informado, limpa as retained messages (`status`, `health`, `config`) do
   * gateway no broker — sem isso, lixo retido acumula para sempre.
   */
  async deprovisionGateway(gatewayId: string, tenantId?: string): Promise<void> {
    if (!this.apiUrl) return;

    await this.deleteMqttUser(gatewayId);
    await this.deleteAclRules(gatewayId);

    // Usuário de sensores (pode não existir — 404 é ignorado nos deletes).
    const sensorUser = this.sensorUsername(gatewayId);
    await this.deleteMqttUser(sensorUser);
    await this.deleteAclRules(sensorUser);

    if (tenantId) {
      await this.purgeRetainedMessages(gatewayId, tenantId);
    }
  }

  /**
   * Remove as retained messages do gateway no broker via a API do retainer do
   * EMQX (`DELETE /mqtt/retainer/message/{topic}`). 404 = não havia mensagem
   * retida (ou retainer desabilitado) — não é erro. Nunca lança: a limpeza de
   * retained é best-effort e não deve impedir a exclusão do gateway.
   */
  async purgeRetainedMessages(gatewayId: string, tenantId: string): Promise<void> {
    if (!this.apiUrl) return;

    const prefix = `bluebee/${tenantId}/gateway/${gatewayId}`;
    const topics = [`${prefix}/status`, `${prefix}/health`, `${prefix}/config`];

    for (const topic of topics) {
      try {
        const res = await fetch(
          `${this.apiUrl}/mqtt/retainer/message/${encodeURIComponent(topic)}`,
          { method: 'DELETE', headers: { Authorization: this.authHeader } },
        );
        if (res.ok) {
          this.logger.log(`EMQX: retained removida — ${topic}`);
        } else if (res.status !== 404) {
          this.logger.warn(`EMQX: falha ao remover retained ${topic}: HTTP ${res.status}`);
        }
      } catch (err) {
        this.logger.warn(
          `EMQX: erro ao remover retained ${topic}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Cria o usuário MQTT DEDICADO para os equipamentos publicarem (sensores).
   * ACL: publish-only em bluebee/{tenant}/gateway/{gatewayId}/sensors/# — assim um
   * sensor comprometido não consegue publicar em telemetria/config/comandos do gateway.
   * Idempotente: se EMQX_API_URL não estiver configurado, apenas avisa.
   */
  async provisionSensorUser(gatewayId: string, tenantId: string, password: string): Promise<void> {
    if (!this.apiUrl) {
      this.logger.warn(
        `EMQX_API_URL não configurado — credencial de sensor de ${gatewayId} gerada sem ` +
          'provisionamento MQTT. A ACL não será aplicada até configurar o EMQX.',
      );
      return;
    }

    const username = this.sensorUsername(gatewayId);
    await this.createMqttUser(username, password);
    await this.createSensorAclRules(username, tenantId, gatewayId);
  }

  /** Nome do usuário MQTT dos sensores de um gateway. */
  private sensorUsername(gatewayId: string): string {
    return `${gatewayId}-sensors`;
  }

  /** Nome do usuário MQTT dedicado de um dispositivo em modo tópico raiz. */
  deviceUsername(deviceId: string): string {
    return `dev-${deviceId}`;
  }

  /**
   * Provisiona a credencial DEDICADA de um dispositivo em modo "tópico raiz
   * próprio" (sem prefixo): publish permitido SOMENTE sob `{rootTopic}/#` (e no
   * próprio `{rootTopic}`), subscribe apenas nos tópicos de comando explícitos
   * dos pontos comandáveis. Deny `#` por último. Idempotente (409 → PUT).
   */
  async provisionRootDeviceUser(
    deviceId: string,
    password: string,
    rootTopic: string,
    subscribeTopics: string[],
  ): Promise<void> {
    if (!this.apiUrl) {
      this.logger.warn(
        `EMQX_API_URL não configurado — credencial do dispositivo ${deviceId} gerada sem ACL. ` +
          'Configure EMQX_API_URL para ativar o isolamento por tópico raiz.',
      );
      return;
    }
    const username = this.deviceUsername(deviceId);
    await this.createMqttUser(username, password);
    await this.syncRootDeviceAcl(deviceId, rootTopic, subscribeTopics);
  }

  /**
   * Reaplica somente a ACL do dispositivo em modo raiz (após adicionar/editar
   * pontos comandáveis — os tópicos de subscribe mudam). No-op sem EMQX.
   */
  async syncRootDeviceAcl(
    deviceId: string,
    rootTopic: string,
    subscribeTopics: string[],
  ): Promise<void> {
    if (!this.apiUrl) return;
    await this.ensureAclSource();
    const username = this.deviceUsername(deviceId);
    const uniqueSubs = [...new Set(subscribeTopics.filter((t) => !!t?.trim()))];
    const rules = [
      { topic: rootTopic, permission: 'allow', action: 'publish' },
      { topic: `${rootTopic}/#`, permission: 'allow', action: 'publish' },
      ...uniqueSubs.map((topic) => ({ topic, permission: 'allow', action: 'subscribe' })),
      { topic: '#', permission: 'deny', action: 'all' },
    ];
    await this.upsertUserAclRules(username, rules);
    this.logger.log(
      `EMQX: ACL do dispositivo raiz ${username} aplicada — publish em ${rootTopic}/#, ` +
        `${uniqueSubs.length} tópico(s) de subscribe`,
    );
  }

  /** Remove credencial + ACL do dispositivo em modo raiz (exclusão do device). */
  async deprovisionRootDeviceUser(deviceId: string): Promise<void> {
    if (!this.apiUrl) return;
    const username = this.deviceUsername(deviceId);
    await this.deleteMqttUser(username);
    await this.deleteAclRules(username);
  }

  /**
   * Reconstroi a ACL do usuário do GATEWAY incluindo permissão de SUBSCRIBE nos
   * namespaces raiz dos dispositivos em modo "tópico raiz próprio". Sem isso o
   * bridge do gateway não consegue assinar tópicos fora de `bluebee/…` (a ACL
   * base nega `#`). As regras base do gateway são preservadas; o deny `#` fica
   * sempre por último.
   */
  async applyGatewayRootAcl(
    gatewayId: string,
    tenantId: string,
    rootTopics: string[],
  ): Promise<void> {
    if (!this.apiUrl) return;
    await this.ensureAclSource();
    const topicPrefix = `bluebee/${tenantId}/gateway/${gatewayId}`;
    const uniqueRoots = [...new Set(rootTopics.filter((t) => !!t?.trim()))];
    const rules = [
      { topic: `${topicPrefix}/#`, permission: 'allow', action: 'all' },
      ...uniqueRoots.flatMap((root) => [
        { topic: root, permission: 'allow', action: 'subscribe' },
        { topic: `${root}/#`, permission: 'allow', action: 'all' },
      ]),
      { topic: '#', permission: 'deny', action: 'all' },
    ];
    await this.upsertUserAclRules(gatewayId, rules);
    this.logger.log(
      `EMQX: ACL do gateway ${gatewayId} reaplicada com ${uniqueRoots.length} tópico(s) raiz`,
    );
  }

  /** POST em lote (array) com fallback PUT no 409 — padrão EMQX 5.x. */
  private async upsertUserAclRules(
    username: string,
    rules: Array<{ topic: string; permission: string; action: string }>,
  ): Promise<void> {
    const url = `${this.apiUrl}/authorization/sources/built_in_database/rules/users`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
      body: JSON.stringify([{ username, rules }]),
    });
    if (res.status === 409) {
      const putRes = await fetch(`${url}/${username}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
        body: JSON.stringify({ username, rules }),
      });
      if (!putRes.ok) {
        const body = await putRes.text();
        this.logger.warn(`EMQX: falha ao atualizar ACL de ${username}: HTTP ${putRes.status} — ${body}`);
      }
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`EMQX: falha ao criar ACL de ${username}: HTTP ${res.status} — ${body}`);
    }
  }

  /**
   * Reaplica a ACL do usuário de sensores de um gateway já provisionado.
   * Usado no boot para propagar novas regras (ex.: subscribe no sub-espaço de
   * comando) a gateways existentes. No-op sem EMQX configurado.
   */
  async reapplySensorAcl(gatewayId: string, tenantId: string): Promise<void> {
    if (!this.apiUrl) return;
    await this.createSensorAclRules(this.sensorUsername(gatewayId), tenantId, gatewayId);
  }

  private async createSensorAclRules(username: string, tenantId: string, gatewayId: string): Promise<void> {
    await this.ensureAclSource();
    const url = `${this.apiUrl}/authorization/sources/built_in_database/rules/users`;
    const sensorPrefix = `bluebee/${tenantId}/gateway/${gatewayId}/sensors`;
    const sensorTopic = `${sensorPrefix}/#`;

    // Publish em todo o namespace de sensores (telemetria + respostas RPC).
    // Subscribe SOMENTE no sub-espaço de comando — um sensor comprometido não
    // consegue escutar telemetria de outros sensores nem tópicos do gateway.
    // Cobrimos sub-tópicos de 1 e 2 níveis (ex.: "shelly1/rpc" e "sala/shelly1/rpc").
    const rules = [
      { topic: sensorTopic, permission: 'allow', action: 'publish' },
      { topic: `${sensorPrefix}/+/rpc`, permission: 'allow', action: 'subscribe' },
      { topic: `${sensorPrefix}/+/+/rpc`, permission: 'allow', action: 'subscribe' },
      { topic: `${sensorPrefix}/+/command/#`, permission: 'allow', action: 'subscribe' },
      { topic: `${sensorPrefix}/+/+/command/#`, permission: 'allow', action: 'subscribe' },
      { topic: '#', permission: 'deny', action: 'all' },
    ];

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
      body: JSON.stringify([{ username, rules }]),
    });

    if (res.status === 409) {
      const putRes = await fetch(
        `${this.apiUrl}/authorization/sources/built_in_database/rules/users/${username}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
          body: JSON.stringify({ username, rules }),
        },
      );
      if (!putRes.ok) {
        const body = await putRes.text();
        this.logger.warn(`EMQX: falha ao atualizar ACL de sensor para ${username}: HTTP ${putRes.status} — ${body}`);
      }
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`EMQX: falha ao criar ACL de sensor para ${username}: HTTP ${res.status} — ${body}`);
    }

    this.logger.log(
      `EMQX: ACL de sensor aplicada para ${username} — publish em ${sensorTopic}, ` +
        'subscribe no sub-espaço de comando (rpc/command)',
    );
  }

  private async createMqttUser(userId: string, password: string): Promise<void> {
    const url = `${this.apiUrl}/authentication/password_based:built_in_database/users`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
      body: JSON.stringify({ user_id: userId, password, is_superuser: false }),
    });

    if (res.status === 409) {
      this.logger.warn(`EMQX: usuário MQTT ${userId} já existe — atualizando senha`);
      await this.updateMqttUserPassword(userId, password);
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`EMQX: falha ao criar usuário ${userId}: HTTP ${res.status} — ${body}`);
    }

    this.logger.log(`EMQX: usuário MQTT criado — ${userId}`);
  }

  private async updateMqttUserPassword(userId: string, password: string): Promise<void> {
    const url = `${this.apiUrl}/authentication/password_based:built_in_database/users/${userId}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.warn(`EMQX: falha ao atualizar senha de ${userId}: HTTP ${res.status} — ${body}`);
    }
  }

  /**
   * Garante que a fonte de autorização `built_in_database` exista e esteja
   * habilitada no EMQX. Em instâncias onde ela não foi criada, o endpoint de
   * regras retorna HTTP 404 "Not found: built_in_database". Idempotente.
   */
  private async ensureAclSource(): Promise<void> {
    if (this.aclSourceEnsured) return;

    try {
      const listRes = await fetch(`${this.apiUrl}/authorization/sources`, {
        headers: { Authorization: this.authHeader },
      });
      if (listRes.ok) {
        const body = (await listRes.json()) as unknown;
        const sources = Array.isArray(body)
          ? (body as Array<{ type?: string }>)
          : ((body as { data?: Array<{ type?: string }> }).data ?? []);
        if (sources.some((s) => s.type === 'built_in_database')) {
          this.aclSourceEnsured = true;
          return;
        }
      }
    } catch (err) {
      this.logger.warn(`EMQX: falha ao listar fontes de autorização: ${(err as Error).message}`);
    }

    const createRes = await fetch(`${this.apiUrl}/authorization/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
      body: JSON.stringify({ type: 'built_in_database', enable: true }),
    });

    if (createRes.ok || createRes.status === 409) {
      this.aclSourceEnsured = true;
      this.logger.log('EMQX: fonte de autorização built_in_database habilitada');
    } else {
      const body = await createRes.text();
      this.logger.warn(
        `EMQX: não foi possível habilitar a fonte built_in_database: HTTP ${createRes.status} — ${body}`,
      );
    }
  }

  private async createAclRules(username: string, tenantId: string): Promise<void> {
    await this.ensureAclSource();
    const url = `${this.apiUrl}/authorization/sources/built_in_database/rules/users`;
    const topicPrefix = `bluebee/${tenantId}/gateway/${username}`;

    // EMQX 5.x: o endpoint de criação em lote espera um ARRAY de
    // { username, rules }, não um objeto único (do contrário retorna
    // HTTP 400 bad_array_index_keys).
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
      body: JSON.stringify([
        {
          username,
          rules: [
            { topic: `${topicPrefix}/#`, permission: 'allow', action: 'all' },
            { topic: '#', permission: 'deny', action: 'all' },
          ],
        },
      ]),
    });

    if (res.status === 409) {
      this.logger.warn(`EMQX: ACL para ${username} já existe — atualizando`);
      await this.updateAclRules(username, tenantId);
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`EMQX: falha ao criar ACL para ${username}: HTTP ${res.status} — ${body}`);
    }

    this.logger.log(`EMQX: ACL criada para ${username} — tópico: ${topicPrefix}/#`);
  }

  private async updateAclRules(username: string, tenantId: string): Promise<void> {
    const url = `${this.apiUrl}/authorization/sources/built_in_database/rules/users/${username}`;
    const topicPrefix = `bluebee/${tenantId}/gateway/${username}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
      body: JSON.stringify({
        rules: [
          { topic: `${topicPrefix}/#`, permission: 'allow', action: 'all' },
          { topic: '#', permission: 'deny', action: 'all' },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.warn(`EMQX: falha ao atualizar ACL para ${username}: HTTP ${res.status} — ${body}`);
    }
  }

  private async deleteMqttUser(userId: string): Promise<void> {
    const url = `${this.apiUrl}/authentication/password_based:built_in_database/users/${userId}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });

    if (!res.ok && res.status !== 404) {
      this.logger.warn(`EMQX: falha ao remover usuário ${userId}: HTTP ${res.status}`);
    } else {
      this.logger.log(`EMQX: usuário MQTT removido — ${userId}`);
    }
  }

  private async deleteAclRules(username: string): Promise<void> {
    const url = `${this.apiUrl}/authorization/sources/built_in_database/rules/users/${username}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });

    if (!res.ok && res.status !== 404) {
      this.logger.warn(`EMQX: falha ao remover ACL para ${username}: HTTP ${res.status}`);
    } else {
      this.logger.log(`EMQX: ACL removida para ${username}`);
    }
  }
}
