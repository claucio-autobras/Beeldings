/**
 * Cria (ou atualiza) usuários MQTT no EMQX para o gateway e o backend.
 * Uso: node scripts/reprovision-gateway.mjs
 *
 * Lê credenciais de apps/gateway/.env e apps/backend/.env
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function parseEnv(filePath) {
  try {
    const text = readFileSync(filePath, 'utf-8');
    return Object.fromEntries(
      text
        .split('\n')
        .filter(line => line.trim() && !line.startsWith('#'))
        .map(line => {
          const [key, ...rest] = line.split('=');
          return [key.trim(), rest.join('=').trim()];
        }),
    );
  } catch {
    return {};
  }
}

const gatewayEnv = parseEnv(resolve(root, 'apps/gateway/.env'));
const backendEnv = parseEnv(resolve(root, 'apps/backend/.env'));

const EMQX_API_URL    = backendEnv.EMQX_API_URL    || 'http://localhost:18083/api/v5';
const EMQX_API_KEY    = backendEnv.EMQX_API_KEY    || '';
const EMQX_API_SECRET = backendEnv.EMQX_API_SECRET || '';

if (!EMQX_API_KEY || !EMQX_API_SECRET) {
  console.error('❌  apps/backend/.env sem EMQX_API_KEY / EMQX_API_SECRET');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${EMQX_API_KEY}:${EMQX_API_SECRET}`).toString('base64')}`;

async function emqxRequest(method, path, body) {
  const res = await fetch(`${EMQX_API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function createOrUpdateUser(userId, password) {
  let { status, body } = await emqxRequest(
    'POST',
    '/authentication/password_based:built_in_database/users',
    { user_id: userId, password, is_superuser: false },
  );

  if (status === 409) {
    console.log(`  ⚠️  Usuário já existe — atualizando senha de ${userId}...`);
    ({ status, body } = await emqxRequest(
      'PUT',
      `/authentication/password_based:built_in_database/users/${userId}`,
      { password },
    ));
  }

  if (status >= 200 && status < 300) {
    console.log(`  ✅  Usuário MQTT: ${userId}`);
    return true;
  } else {
    console.error(`  ❌  Falha ao criar usuário ${userId}: HTTP ${status} — ${body}`);
    return false;
  }
}

async function createOrUpdateAcl(username, tenantId) {
  const topicPrefix = `bluebee/${tenantId}/gateway/${username}`;
  let { status, body } = await emqxRequest(
    'POST',
    '/authorization/sources/built_in_database/rules/users',
    {
      username,
      rules: [
        { topic: `${topicPrefix}/#`, permission: 'allow', action: 'all' },
        { topic: '#',                permission: 'deny',  action: 'all' },
      ],
    },
  );

  if (status === 409) {
    console.log(`  ⚠️  ACL já existe — atualizando ${username}...`);
    ({ status, body } = await emqxRequest(
      'PUT',
      `/authorization/sources/built_in_database/rules/users/${username}`,
      {
        rules: [
          { topic: `${topicPrefix}/#`, permission: 'allow', action: 'all' },
          { topic: '#',                permission: 'deny',  action: 'all' },
        ],
      },
    ));
  }

  if (status >= 200 && status < 300) {
    console.log(`  ✅  ACL: ${topicPrefix}/#`);
    return true;
  } else {
    console.error(`  ❌  Falha ao criar ACL para ${username}: HTTP ${status} — ${body}`);
    return false;
  }
}

// ─── 1. Gateway ───────────────────────────────────────────────────────────────

const GATEWAY_ID  = gatewayEnv.GATEWAY_ID  || '';
const TENANT_ID   = gatewayEnv.TENANT_ID   || '';
const MQTT_USER   = gatewayEnv.MQTT_USERNAME || GATEWAY_ID;
const MQTT_PASS   = gatewayEnv.MQTT_PASSWORD || '';

if (!GATEWAY_ID || !MQTT_PASS) {
  console.warn('⚠️  apps/gateway/.env sem GATEWAY_ID/MQTT_PASSWORD — pulando gateway');
} else {
  console.log(`\n── Gateway: ${GATEWAY_ID} ─────────────────────`);
  const userOk = await createOrUpdateUser(MQTT_USER, MQTT_PASS);
  if (userOk && TENANT_ID) await createOrUpdateAcl(MQTT_USER, TENANT_ID);
}

// ─── 2. Backend MQTT client ───────────────────────────────────────────────────

const BACKEND_MQTT_USER = backendEnv.MQTT_USERNAME || '';
const BACKEND_MQTT_PASS = backendEnv.MQTT_PASSWORD || '';

if (!BACKEND_MQTT_USER || !BACKEND_MQTT_PASS) {
  console.warn('⚠️  apps/backend/.env sem MQTT_USERNAME/MQTT_PASSWORD — pulando backend');
} else {
  console.log(`\n── Backend MQTT: ${BACKEND_MQTT_USER} ──────────────────`);
  await createOrUpdateUser(BACKEND_MQTT_USER, BACKEND_MQTT_PASS);
  // Backend não precisa de ACL restrito — usa superuser ou tópico livre
}

console.log('\n🟢  Provisionamento concluído. Reinicie gateway e backend.\n');
