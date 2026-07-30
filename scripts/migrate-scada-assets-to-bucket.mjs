#!/usr/bin/env node
/**
 * Migração única: sobe todos os arquivos de `uploads/scada/<tenant>/<arquivo>`
 * para o bucket do App Storage do Replit, preservando o caminho relativo
 * (`<PRIVATE_OBJECT_DIR>/scada/<tenant>/<arquivo>`).
 *
 * Idempotente: arquivos que já existem no bucket são pulados.
 *
 * Uso:
 *   node scripts/migrate-scada-assets-to-bucket.mjs [dir]
 *     dir — raiz dos uploads (default: apps/backend/uploads/scada; também
 *           respeita SCADA_UPLOAD_DIR se definido)
 *
 * Rodar no dev E na VM de produção (que tem os uploads antigos em disco)
 * antes/logo após o próximo deploy.
 */
import { Storage } from '@google-cloud/storage';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

function resolveRoot() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  if (process.env.SCADA_UPLOAD_DIR) return path.resolve(process.env.SCADA_UPLOAD_DIR);
  return path.resolve('apps/backend/uploads/scada');
}

function resolveBase() {
  const dir = process.env.PRIVATE_OBJECT_DIR ?? '';
  if (!dir) {
    console.error('ERRO: PRIVATE_OBJECT_DIR não definido — provisione o App Storage.');
    process.exit(1);
  }
  const parts = dir.replace(/^\/+/, '').split('/');
  return { bucketName: parts[0], prefix: parts.slice(1).join('/') };
}

async function main() {
  const root = resolveRoot();
  const { bucketName, prefix } = resolveBase();

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    console.log(`Nada a migrar: diretório inexistente (${root}).`);
    return;
  }

  const storage = new Storage({
    credentials: {
      audience: 'replit',
      subject_token_type: 'access_token',
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: 'external_account',
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: 'json', subject_token_field_name: 'access_token' },
      },
      universe_domain: 'googleapis.com',
    },
    projectId: '',
  });
  const bucket = storage.bucket(bucketName);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenantDir of entries) {
    if (!tenantDir.isDirectory()) continue;
    const tenant = tenantDir.name;
    const files = await fs.readdir(path.join(root, tenant), { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      const relative = `${tenant}/${f.name}`;
      const objectName = [prefix, 'scada', relative].filter(Boolean).join('/');
      const object = bucket.file(objectName);
      try {
        const [exists] = await object.exists();
        if (exists) {
          skipped += 1;
          console.log(`SKIP  ${relative} (já existe no bucket)`);
          continue;
        }
        const buffer = await fs.readFile(path.join(root, tenant, f.name));
        const contentType =
          MIME_BY_EXT[path.extname(f.name).toLowerCase()] ?? 'application/octet-stream';
        await object.save(buffer, { contentType, resumable: false });
        migrated += 1;
        console.log(`OK    ${relative} → gs://${bucketName}/${objectName}`);
      } catch (err) {
        failed += 1;
        console.error(`ERRO  ${relative}: ${err.message}`);
      }
    }
  }

  console.log(`\nResumo: ${migrated} migrados, ${skipped} pulados (já existiam), ${failed} falhas.`);
  if (failed > 0) process.exit(1);
}

main();
