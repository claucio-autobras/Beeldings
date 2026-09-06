/**
 * Tradução de erros de ações de dispositivos para mensagens amigáveis em português.
 *
 * Centraliza a lógica que antes vivia no `BACnetSyncModal`, para que todos os
 * modais de dispositivos (criar/editar/remover/adicionar ponto/sincronizar)
 * exibam mensagens consistentes e acionáveis em vez do `err.message` cru.
 */

export interface DeviceErrorContext {
  /** Mensagem genérica usada quando nenhuma regra específica casar e não houver detalhe. */
  fallback?: string;
  /** Endereço IP do dispositivo — usado em mensagens de controladora sem resposta. */
  ip?: string;
  /** Porta do dispositivo — usada junto do IP. */
  port?: number | string;
}

/**
 * Converte um erro desconhecido (de uma chamada de serviço de dispositivo) em uma
 * mensagem amigável em português. Mensagens técnicas comuns (timeout, falha de
 * rede, controladora sem resposta, status HTTP) ganham orientação clara. Quando a
 * mensagem original já é amigável, ela é repassada; sem mensagem, usa o fallback.
 */
export function translateDeviceError(err: unknown, context: DeviceErrorContext = {}): string {
  const fallback = context.fallback ?? 'Ocorreu um erro inesperado. Tente novamente.';

  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;

  const lower = raw.toLowerCase();

  if (
    lower.includes('timeout') ||
    lower.includes('gateway nao respondeu') ||
    lower.includes('gateway não respondeu')
  ) {
    return 'O gateway não respondeu a tempo. Verifique se o serviço do gateway está rodando e se o broker MQTT está ativo.';
  }

  if (
    lower.includes('não respondeu') ||
    lower.includes('nao respondeu') ||
    lower.includes('verifique ip')
  ) {
    const where = context.ip
      ? ` em ${context.ip}${context.port != null ? `:${context.port}` : ''}`
      : '';
    return `A controladora não respondeu${where}. Verifique se o dispositivo está ligado e acessível na rede.`;
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('fetch')
  ) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e se o backend está disponível.';
  }

  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('não autenticado')
  ) {
    return 'Sua sessão expirou. Faça login novamente para continuar.';
  }

  if (
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('permiss')
  ) {
    return 'Você não tem permissão para executar esta ação.';
  }

  if (lower.includes('404') || lower.includes('not found')) {
    return 'Recurso não encontrado. Ele pode ter sido removido.';
  }

  if (
    lower.includes('409') ||
    lower.includes('conflict') ||
    lower.includes('já existe') ||
    lower.includes('duplicate')
  ) {
    // Mensagens de conflito já específicas do backend (ex.: registrador/tag de
    // ponto já cadastrado) já são amigáveis e acionáveis — repasse-as em vez de
    // sobrescrever com o texto genérico.
    if (
      lower.includes('ponto') ||
      lower.includes('registrador') ||
      lower.includes('tag')
    ) {
      return raw;
    }
    return 'Já existe um registro com esses dados. Verifique os valores informados.';
  }

  if (lower.includes('500') || lower.includes('internal server')) {
    return 'Erro interno no servidor. Tente novamente em instantes.';
  }

  // A mensagem original já costuma ser amigável (lançada pelo backend/serviço).
  return raw;
}
