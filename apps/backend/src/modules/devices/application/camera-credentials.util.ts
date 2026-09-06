import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Cifra simétrica (AES-256-GCM) para credenciais de câmera armazenadas em
 * Device.config. A chave é derivada de CAMERA_CREDENTIALS_KEY (se definida)
 * ou do JWT_SECRET — obrigatório em produção de qualquer forma.
 *
 * Formato persistido: "enc:v1:<iv b64>:<authTag b64>:<cipher b64>".
 * A senha NUNCA sai em respostas da API nem em logs; só é decifrada na hora
 * de montar a config publicada ao gateway (MQTT autenticado/TLS).
 */
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const secret = process.env.CAMERA_CREDENTIALS_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'CAMERA_CREDENTIALS_KEY/JWT_SECRET ausente — impossível cifrar credenciais de câmera',
    );
  }
  return createHash('sha256').update(secret).digest();
}

/** Cifra um segredo em texto puro para armazenamento. */
export function encryptCameraSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
  );
}

/** Decifra um segredo armazenado. Retorna null se o formato for inválido. */
export function decryptCameraSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) {
    // Valor legado em texto puro (não deve existir para ONVIF) — devolve como está.
    return stored;
  }
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const tag = Buffer.from(tagB64, 'base64');
    // Exige tag de autenticação completa (16 bytes) — impede aceitar tags truncadas.
    if (tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'), {
      authTagLength: 16,
    });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}
