import { BadRequestException } from '@nestjs/common';
import { GatewaysController } from './gateways.controller';

/**
 * Testes de resolveBaseUrl — a URL base usada na URL de download do pacote
 * OTA deve sempre sair válida (protocolo + host) ou o disparo deve ser
 * recusado com erro claro ANTES de publicar o comando MQTT.
 */
describe('GatewaysController.resolveBaseUrl', () => {
  const controller = new GatewaysController(
    {} as never,
    {} as never,
  ) as unknown as {
    resolveBaseUrl(req: unknown): string;
  };
  const originalEnv = process.env.BACKEND_PUBLIC_URL;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BACKEND_PUBLIC_URL;
    else process.env.BACKEND_PUBLIC_URL = originalEnv;
  });

  const req = (headers: Record<string, string> = {}, protocol?: string) => ({
    headers,
    protocol,
  });

  it('usa BACKEND_PUBLIC_URL como veio quando já tem protocolo', () => {
    process.env.BACKEND_PUBLIC_URL = 'https://api.exemplo.com/';
    expect(controller.resolveBaseUrl(req())).toBe('https://api.exemplo.com');
  });

  it('prefixa https:// quando BACKEND_PUBLIC_URL vem sem protocolo', () => {
    process.env.BACKEND_PUBLIC_URL = 'api.exemplo.com';
    expect(controller.resolveBaseUrl(req())).toBe('https://api.exemplo.com');
  });

  it('recusa BACKEND_PUBLIC_URL inválida com erro 4xx claro', () => {
    process.env.BACKEND_PUBLIC_URL = 'https://';
    expect(() => controller.resolveBaseUrl(req())).toThrow(BadRequestException);
  });

  it('deriva dos headers x-forwarded-* quando a env não está setada', () => {
    delete process.env.BACKEND_PUBLIC_URL;
    expect(
      controller.resolveBaseUrl(
        req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'meu.app' }),
      ),
    ).toBe('https://meu.app/api');
  });

  it('recusa quando não há host nenhum (env vazia + sem headers)', () => {
    process.env.BACKEND_PUBLIC_URL = '';
    expect(() => controller.resolveBaseUrl(req())).toThrow(BadRequestException);
  });
});
