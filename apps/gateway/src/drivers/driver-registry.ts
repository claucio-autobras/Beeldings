/**
 * DriverRegistry — registro dinâmico de factories de drivers.
 *
 * Fase 1: existe mas não é usado pelos PollingServices (que instanciam seus
 * drivers diretamente). Fase 2+: o orquestrador unificado chamará
 * `registry.create(protocol)` para obter um driver sem saber a classe concreta.
 *
 * O registro é feito por factory (não por instância) — cada chamada a
 * `create()` retorna uma nova instância independente, adequada para uso
 * por device (stateful).
 */

import { Injectable } from '@nestjs/common';
import type { CollectionDriver } from './collection-driver.interface';

export type DriverFactory = () => CollectionDriver;

@Injectable()
export class DriverRegistry {
  private readonly factories = new Map<string, DriverFactory>();

  /**
   * Registra uma factory de driver para um protocolo.
   * Sobrescreve silenciosamente se o protocolo já estava registrado
   * (permite hot-reload em testes).
   */
  register(protocol: string, factory: DriverFactory): void {
    this.factories.set(protocol, factory);
  }

  /**
   * Verifica se há uma factory registrada para o protocolo.
   */
  has(protocol: string): boolean {
    return this.factories.has(protocol);
  }

  /**
   * Cria uma nova instância de driver para o protocolo informado.
   * Retorna null quando o protocolo não está registrado.
   */
  create(protocol: string): CollectionDriver | null {
    const factory = this.factories.get(protocol);
    return factory ? factory() : null;
  }

  /**
   * Lista os protocolos registrados (diagnóstico/log).
   */
  listProtocols(): string[] {
    return [...this.factories.keys()];
  }
}
