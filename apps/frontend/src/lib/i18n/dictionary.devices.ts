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

  // ── Labels do badge OpRoleBadge nas listas de pontos (Modo já declarado acima) ──
  'Status':   'Status',
  'Setpoint': 'Setpoint',

  // ── Botão "Definir papel Status" no popover da estrela ──
  'Definir papel Status': 'Set Status role',
  'Definindo papel...': 'Setting role…',
  'Erro ao definir papel. Tente novamente.': 'Failed to set role. Please try again.',

  // ── Diálogo de fallback (dispositivos sem modal dedicado) ──
  'Dispositivo': 'Device',
  'Nome': 'Name',
  'Protocolo': 'Protocol',
  'Local': 'Location',
  'Fechar': 'Close',
  'Remover dispositivo': 'Remove device',
  'Remover dispositivo?': 'Remove device?',
  'Remover': 'Remove',
  'O dispositivo': 'The device',
  'e todos os seus pontos, históricos e alarmes serão excluídos permanentemente. Esta ação não pode ser desfeita.':
    'and all its points, history, and alarms will be permanently deleted. This action cannot be undone.',
  'Este tipo de dispositivo é gerenciado em outra área do sistema. Aqui você pode apenas remover o registro.':
    'This device type is managed in another area of the system. Here you can only remove the record.',
  'Erro ao remover dispositivo. Tente novamente.': 'Failed to remove device. Please try again.',
};
