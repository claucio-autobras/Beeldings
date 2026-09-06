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
  'Diagnóstico guiado': 'Guided diagnosis',
  'Verificar monitoramento': 'Verify monitoring',
  'Buscando as leituras homologadas para esta': 'Looking for approved readings for this',
  'Resumo da conexão': 'Connection summary',
  'Gateway': 'Gateway',
  'Respondendo': 'Responding',
  'Respondeu ao diagnóstico': 'Responded to diagnosis',
  'Sem resposta': 'No response',
  'Equipamento': 'Equipment',
  'Respondeu ao SNMP': 'Responded to SNMP',
  'Não respondeu': 'Did not respond',
  'Perfil homologado': 'Approved profile',
  'Encontrado': 'Found',
  'Não identificado': 'Not identified',
  'Encontrando as fontes homologadas…': 'Finding approved sources…',
  'Testando a comunicação…': 'Testing communication…',
  'leituras verificadas': 'readings checked',
  'O gateway está verificando o equipamento. Isso pode levar alguns segundos.':
    'The gateway is checking the equipment. This may take a few seconds.',
  'Gateway não respondeu': 'Gateway did not respond',
  'Não foi possível concluir a busca': 'The search could not be completed',
  'O gateway não respondeu ao diagnóstico. Verifique se ele está online e tente novamente.':
    'The gateway did not respond to the diagnosis. Check that it is online and try again.',
  'A busca falhou antes de confirmar as leituras.':
    'The search failed before confirming the readings.',
  'Nova tentativa': 'Try again',
  'O equipamento respondeu, mas a credencial SNMP não confere':
    'The equipment responded, but the SNMP credential is incorrect',
  'O equipamento não respondeu ao SNMP': 'The equipment did not respond to SNMP',
  'Confira a community cadastrada e faça uma nova tentativa.':
    'Check the registered community and try again.',
  'Isso não significa valor zero ou falta de uma métrica. Verifique se o SNMP está habilitado e tente novamente.':
    'This does not mean zero or that a metric is missing. Check that SNMP is enabled and try again.',
  'Leituras encontradas': 'Readings found',
  'Estas são as informações que serão monitoradas no equipamento.':
    'These are the readings that will be monitored on the equipment.',
  'com leitura': 'with a reading',
  'lida às': 'read at',
  'Nenhuma leitura homologada foi encontrada neste equipamento.':
    'No approved reading was found on this equipment.',
  'As leituras que já funcionam continuam ativas. Não há nenhuma correção nova para aplicar.':
    'Readings that already work remain active. There is no new correction to apply.',
  'leitura pronta para ativar': 'reading ready to activate',
  'leituras prontas para ativar ou corrigir': 'readings ready to activate or correct',
  'A ação abaixo usa somente fontes homologadas que responderam agora.':
    'The action below uses only approved sources that responded now.',
  'Não foi possível aplicar as leituras.': 'The readings could not be applied.',
  'Monitoramento concluído': 'Monitoring complete',
  'As leituras homologadas foram enviadas ao gateway e já podem ser acompanhadas.':
    'The approved readings were sent to the gateway and can now be monitored.',
  'Ativar e corrigir leituras': 'Activate and correct readings',
  'Corrigida': 'Corrected',
  'Não disponível': 'Not available',
  'Precisa de nova tentativa': 'Needs another attempt',
  'Leitura confirmada e já pronta para o monitoramento.':
    'Reading confirmed and ready for monitoring.',
  'Uma fonte homologada respondeu e está pronta para ser ativada.':
    'An approved source responded and is ready to be activated.',
  'Esta informação não existe ou não foi encontrada neste equipamento.':
    'This information does not exist or was not found on this equipment.',
  'O equipamento respondeu, mas esta leitura não respondeu agora.':
    'The equipment responded, but this reading did not respond now.',
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
