// Dicionário pt-BR → en do módulo Dispositivos (pontos: papel operacional e crítico).
export const DICT_DEVICES: Record<string, string> = {
  // ── Papel operacional do ponto ──
  'Papel operacional': 'Operational role',
  'Nenhum': 'None',
  'Modo': 'Mode',
  'Pontos com papel "Status" aparecem como "ativos agora" no card Ativos Críticos quando o valor está ativo e o dispositivo online.':
    'Points with the "Status" role show as "active now" on the Critical Assets card when the value is active and the device is online.',
  'Não foi possível salvar o papel operacional. Tente novamente.':
    'Could not save the operational role. Please try again.',

  // ── Dica junto à estrela de crítico ──
  'Sem papel "Status", este ponto só aparece no card Ativos Críticos quando estiver em alarme. Defina o papel operacional no painel do ponto.':
    'Without the "Status" role, this point only appears on the Critical Assets card while in alarm. Set the operational role in the point panel.',
  'Entendi': 'Got it',
  'Remover dos ativos críticos': 'Remove from critical assets',
  'Marcar como ativo crítico': 'Mark as critical asset',
};
