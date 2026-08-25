// Dicionário pt-BR → en do módulo Dispositivos (pontos: papel operacional e crítico).
export const DICT_DEVICES: Record<string, string> = {
  // ── Papel operacional do ponto ──
  'Papel operacional': 'Operational role',
  'Nenhum': 'None',
  'Modo': 'Mode',
  'Falha': 'Fault',
  'Use "Status" para o ponto que diz se o equipamento está ligado/desligado e "Falha" para o ponto que indica defeito (ex.: "Falha Bomba 1"). É isso que define como o item aparece no card Ativos Críticos.':
    'Use "Status" for the point that says whether the equipment is on/off and "Fault" for the point that signals a defect (e.g. "Pump 1 Fault"). This defines how the item shows on the Critical Assets card.',
  'Sem papel definido — no card Ativos Críticos o item aparece só com o estado de comunicação.':
    'No role set — on the Critical Assets card the item shows only its communication state.',
  'Informa se o equipamento está ligado ou desligado — o card Ativos Críticos mostra "Ligado há X" ou "Desligado".':
    'Tells whether the equipment is on or off — the Critical Assets card shows "Running for X" or "Off".',
  'Informa se o equipamento está em defeito — valor ativo mostra o item como "Em falha há X" no card, mesmo sem regra de alarme.':
    'Tells whether the equipment has a defect — an active value shows the item as "In fault for X" on the card, even without an alarm rule.',
  'Modo de operação (ex.: automático/manual) — usado pela IA para análise, não afeta o card.':
    'Operating mode (e.g. auto/manual) — used by the AI for analysis, does not affect the card.',
  'Valor de ajuste desejado — usado pela IA para análise, não afeta o card.':
    'Desired setpoint value — used by the AI for analysis, does not affect the card.',
  'Não foi possível salvar o papel operacional. Tente novamente.':
    'Could not save the operational role. Please try again.',

  // ── Dica junto à estrela de crítico ──
  'Este ponto sempre aparece no card Ativos Críticos. Defina o papel "Status" (ligado/desligado) ou "Falha" (defeito) no painel do ponto para o card mostrar o estado certo.':
    'This point always appears on the Critical Assets card. Set the "Status" (on/off) or "Fault" (defect) role in the point panel so the card shows the right state.',
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

  // ── Selo neutro por ponto quando o equipamento está sem comunicação ──
  'Sem comunicação': 'No communication',
  'Equipamento sem comunicação — o último status conhecido pode estar desatualizado.':
    'Device not communicating — the last known status may be outdated.',
};
