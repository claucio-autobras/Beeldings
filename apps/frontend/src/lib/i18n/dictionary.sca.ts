// ─── SCA (Controle de Acesso) + SnmpDiagnoseModal compartilhado ───────────────
export const DICT_SCA: Record<string, string> = {
  // ── Artigos / palavras isoladas ───────────────────────────────────────────
  'O': 'The',
  // ── Teste SNMP pré-cadastro ───────────────────────────────────────────────
  'Testar SNMP': 'Test SNMP',
  'Testando…': 'Testing…',
  'Preencha o IP e selecione o gateway para testar.':
    'Fill in the IP and select the gateway to test.',
  'Controladora respondeu ao SNMP': 'Controller responded to SNMP',
  'Controladora não respondeu ao SNMP (verifique community, porta e se o SNMP está habilitado)':
    'Controller did not respond to SNMP (check community, port and whether SNMP is enabled)',
  'sem resposta': 'no response',
  // ── Página SCA ────────────────────────────────────────────────────────────
  'SCA — Controle de Acesso': 'SCA — Access Control',
  'Controladoras de acesso monitoradas via SNMP':
    'Access controllers monitored via SNMP',
  'Adicionar controladora': 'Add controller',
  'controladora': 'controller',
  'controladoras': 'controllers',
  'Nenhuma controladora cadastrada': 'No controllers registered',
  'Clique em "Adicionar controladora" para começar.':
    'Click "Add controller" to get started.',
  'Online': 'Online',
  'Offline': 'Offline',
  'Sem dados': 'No data',
  'não suportado': 'not supported',
  'sem dados': 'no data',
  'OID não suportado pela controladora (último diagnóstico SNMP)':
    'OID not supported by the controller (last SNMP diagnosis)',
  'Alarmes e trends': 'Alarms & trends',
  'Diagnóstico SNMP': 'SNMP Diagnosis',
  'Editar': 'Edit',
  'Excluir': 'Delete',
  'online': 'online',

  // ── Formulário ────────────────────────────────────────────────────────────
  'Editar controladora': 'Edit controller',
  'Cliente *': 'Client *',
  'Selecione o cliente…': 'Select client…',
  'Site': 'Site',
  'Sem site': 'No site',
  'Gateway (faz o polling) *': 'Gateway (runs polling) *',
  'Selecione…': 'Select…',
  'Nome *': 'Name *',
  'Controladora recepção': 'Reception controller',
  'Endereço IP *': 'IP Address *',
  'Porta SNMP': 'SNMP Port',
  'Versão SNMP': 'SNMP Version',
  'Community': 'Community',
  'Polling (s)': 'Polling (s)',
  'Fabricante (opcional)': 'Manufacturer (optional)',
  'Ex.: Hikvision, Control iD, Intelbras…': 'E.g.: Hikvision, Control iD, Intelbras…',
  'Identifica o perfil de OIDs proprietários da controladora.':
    'Identifies the proprietary OID profile for the controller.',
  'Os pontos de saúde (status, uptime, CPU, memória, temperatura, pacotes perdidos e perda de ping) são criados automaticamente e podem gerar alarmes e trends como qualquer outro ponto.':
    'Health points (status, uptime, CPU, memory, temperature, lost packets and ping loss) are created automatically and can generate alarms and trends like any other point.',
  'Cancelar': 'Cancel',
  'Salvar': 'Save',
  'Adicionar': 'Add',
  'Alarmes e Trends': 'Alarms & Trends',
  'Fechar': 'Close',

  // ── SnmpDiagnoseModal ─────────────────────────────────────────────────────
  'Diagnóstico SNMP —': 'SNMP Diagnosis —',
  'Testa cada OID cadastrado e os OIDs conhecidos de todos os perfis de fabricante':
    'Tests each registered OID and the known OIDs from all manufacturer profiles',
  'diretamente no': 'directly on the',
  'via gateway.': 'via gateway.',

  // Progress
  'Explorando a MIB…': 'Exploring MIB…',
  'subárvores': 'subtrees',
  'Testando OIDs…': 'Testing OIDs…',
  'Iniciando o diagnóstico no gateway…': 'Starting diagnosis on gateway…',
  'Ainda aguardando o gateway responder… ele pode estar ocupado ou lento.':
    'Still waiting for the gateway to respond… it may be busy or slow.',

  // Errors
  'O gateway está ocupado com outro diagnóstico SNMP. Aguarde e tente novamente.':
    'The gateway is busy with another SNMP diagnosis. Wait and try again.',
  'Tentar novamente': 'Try again',

  // Unreachable
  'respondeu com a community padrão': 'responded with the default community',
  'mas não com a community configurada': 'but not with the configured community',
  'Corrija a community no cadastro.': 'Fix the community in the registration.',
  'não respondeu ao SNMP em nenhuma tentativa (nem ao teste com a community padrão). Verifique se o SNMP está habilitado, a porta':
    'did not respond to SNMP in any attempt (including the test with the default community). Check if SNMP is enabled, the port',
  'e a conectividade de rede a partir do gateway.':
    'and network connectivity from the gateway.',

  // Metric status badges
  'não suportada pelo': 'not supported by the',
  'Funcionando': 'Working',
  'Sugestão disponível': 'Suggestion available',
  'Não funciona': 'Not working',

  // Metric details
  'Sem OID cadastrado para esta métrica.': 'No OID registered for this metric.',
  'Alternativas que funcionaram': 'Alternatives that worked',
  'leu': 'read',
  'Detalhes técnicos': 'Technical details',
  'OID atual:': 'Current OID:',

  // Walk section
  'Avançado: OIDs expostos pelo': 'Advanced: OIDs exposed by the',
  '(walk resumido)': '(summarized walk)',
  'Nenhuma subárvore respondeu.': 'No subtree responded.',
  'Buscar por OID ou valor…': 'Search by OID or value…',
  '(parcial)': '(partial)',
  'copiar': 'copy',
  'copiado': 'copied',
  'Copiar OID': 'Copy OID',

  // Apply
  'OIDs aplicados — o gateway já recebeu a nova configuração.':
    'OIDs applied — the gateway has already received the new configuration.',
  'Aplicar sugestão': 'Apply suggestion',
  'Aplicar sugestões': 'Apply suggestions',
};
