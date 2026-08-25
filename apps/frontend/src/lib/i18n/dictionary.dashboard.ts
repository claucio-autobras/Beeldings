// Dicionário pt-BR → en do módulo Dashboard.
export const DICT_DASHBOARD: Record<string, string> = {
  // ── Page ──
  'visão do Site': 'Site view',
  'Visão global — Todos os Sites': 'Global view — All Sites',
  'Bem-vindo': 'Welcome',
  '7 dias': '7 days',
  '30 dias': '30 days',

  // ── KPIs ──
  'Alarmes Ativos': 'Active Alarms',
  'Aguard. ACK': 'Awaiting ACK',
  'Disp. Offline': 'Offline Devices',
  'Clientes ativos': 'Active clients',
  'IOT/BMS online': 'IoT/BMS online',
  'Câmeras online': 'Cameras online',
  'Gateways online': 'Gateways online',
  'Automações ativas': 'Active automations',
  'Sites/Áreas': 'Sites/Areas',
  'Variação vs período anterior': 'Change vs previous period',

  // ── CriticalAssetsCard ──
  'Ativos Críticos': 'Critical Assets',
  'Equipamentos e pontos sob vigilância': 'Equipment and points under watch',
  'Nenhum ativo crítico marcado': 'No critical asset marked',
  'Marque equipamentos ou pontos com a estrela em Dispositivos para acompanhá-los aqui':
    'Star equipment or points in Devices to track them here',
  'Em falha': 'In fault',
  'há': 'for',
  'Ativo': 'Active',
  'Ligado': 'Running',
  'Desligado': 'Off',
  'Sem resposta': 'No response',
  'Monitorando': 'Monitoring',

  // ── FirstActionModal (primeira ação sugerida por IA) ──
  'Primeira ação sugerida': 'Suggested first action',
  'Resumo da falha': 'Fault summary',
  'Falha sinalizada no dashboard': 'Fault flagged on the dashboard',
  'Em falha há': 'In fault for',
  'ocorrências desta falha nos últimos 30 dias': 'occurrences of this fault in the last 30 days',
  'Primeira ocorrência desta falha nos últimos 30 dias':
    'First occurrence of this fault in the last 30 days',
  'Gerando sugestão com base no alarme, histórico e base de conhecimento...':
    'Generating suggestion from the alarm, history and knowledge base...',
  'A sugestão de IA está indisponível no momento. Use o contexto acima e a navegação abaixo.':
    'The AI suggestion is unavailable right now. Use the context above and the navigation below.',
  'Erro ao gerar a sugestão.': 'Failed to generate the suggestion.',
  'Sugestão da IA': 'AI suggestion',
  'Confiança alta': 'High confidence',
  'Confiança média': 'Medium confidence',
  'Confiança baixa': 'Low confidence',
  'Sugestão de apoio gerada por IA — não substitui o procedimento operacional. A decisão e a execução são do operador.':
    'AI-generated supporting suggestion — it does not replace the operating procedure. Decision and execution are up to the operator.',
  'Histórico de reconhecimentos considerado': 'Acknowledgment history considered',
  'Motivos registrados pelo operador em ocorrências anteriores deste alarme (últimos 90 dias):':
    'Reasons recorded by the operator on previous occurrences of this alarm (last 90 days):',
  'Ver alarme': 'View alarm',
  'Fechar': 'Close',

  // ── CriticalAssetInfoModal (painel informativo do cliente) ──
  'Ativo crítico': 'Critical asset',
  'Sem resposta há': 'No response for',
  'Ligado há': 'Running for',
  'Desligado há': 'Off for',
  'desde': 'since',
  'Sem dados de duração': 'No duration data',
  'Última comunicação': 'Last communication',
  'O equipamento parou de se comunicar com a plataforma — as leituras dele estão indisponíveis até a comunicação voltar. A equipe técnica acompanha este estado.':
    'The equipment stopped communicating with the platform — its readings are unavailable until communication is restored. The technical team monitors this state.',
  'Ver no SCADA': 'View in SCADA',
  'Ver no CFTV': 'View in CCTV',

  // ── ActivityFeedCard ──
  'Atividade Recente': 'Recent Activity',
  'Trilha de auditoria': 'Audit trail',
  'Ver tudo →': 'View all →',
  'Nenhuma atividade registrada ainda': 'No activity recorded yet',
  'agora mesmo': 'just now',

  // ── AutomationsCard ──
  'Automações & Comandos': 'Automations & Commands',
  'Taxa de sucesso': 'Success rate',
  'Sem execuções registradas no período': 'No executions recorded in the period',
  'Nenhum comando recente': 'No recent commands',
  'Ver automações →': 'View automations →',
  'Hoje': 'Today',

  // ── AutomationsModal (visão do cliente, somente leitura) ──
  // 'Automações', 'Fechar' e 'Local' já existem nos dicionários core/alarms.
  'Automações do seu contrato': 'Automations in your contract',
  'Regras configuradas para o seu contrato': 'Rules configured for your contract',
  'Nenhuma automação configurada ainda.': 'No automations configured yet.',
  'Todos os locais': 'All locations',
  'Ativa': 'Active',
  'Inativa': 'Inactive',

  // ── CftvStatusCard ──
  'CFTV Status': 'CCTV Status',
  'Sem dados': 'No data',
  'online': 'online',
  'c/ problema': 'with issues',
  'Ver Câmeras': 'View Cameras',
  'Latência': 'Latency',
  'Tempo ligada': 'Uptime',
  'CPU': 'CPU',
  'Memória': 'Memory',
  'Nenhuma câmera neste escopo': 'No cameras in this scope',
  'câmeras': 'cameras',
  'A câmera não expõe o uptime real — tempo estimado desde que voltou a responder ao monitoramento.':
    'The camera does not expose real uptime — estimated time since it started responding to monitoring again.',

  // ── DeviceAreaTable ──
  'Sem site': 'No site',
  'Status dos Dispositivos': 'Device Status',
  'Distribuição por área em tempo real': 'Real-time distribution by area',
  'Ver todos': 'View all',
  'Nenhum dispositivo cadastrado': 'No devices registered',
  'Cadastre dispositivos na tela de Dispositivos': 'Register devices on the Devices screen',
  'Área': 'Area',
  'Distribuição': 'Distribution',
  'Online': 'Online',
  'Offline': 'Offline',
  'Alarme': 'Alarm',

  // ── GatewaysHealthTable ──
  'Saúde dos Gateways': 'Gateway Health',
  'Conectividade e telemetria de saúde em tempo real':
    'Real-time connectivity and health telemetry',
  'Nenhum gateway cadastrado': 'No gateways registered',
  'Cadastre gateways na tela de Gateways': 'Register gateways on the Gateways screen',
  'Gateway': 'Gateway',
  'Status': 'Status',
  'Saúde': 'Health',
  'Versão': 'Version',
  'Último contato': 'Last contact',
  'Uptime': 'Uptime',
  'Fila': 'Queue',
  'Reconexões': 'Reconnections',
  'disp.': 'avail.',
  'Atualizado': 'Up to date',

  // ── OperationalSummaryCard ──
  'Resumo Operacional': 'Operational Summary',
  'Disponibilidade média dos equipamentos no período (mesma base do relatório de disponibilidade)':
    'Average equipment availability in the period (same basis as the availability report)',

  // ── TopOffendersCard ──
  'Top ofensores': 'Top offenders',
  'Equipamentos e regras que mais alarmaram no período': 'Equipment and rules that alarmed the most in the period',
  'Nenhum alarme no período': 'No alarms in the period',
  'Nenhum equipamento disparou alarmes na janela selecionada': 'No equipment triggered alarms in the selected window',

  // ── Séries de quedas (offline) — usadas no SeverityTimelineCard unificado ──
  'Alarmes disparados': 'Alarms triggered',
  'Quedas (offline)': 'Drops (offline)',

  // ── TenantRankingCard (score composto) ──
  'Ordenado por críticos em falha, gateways offline, alarmes e backlog de ACK':
    'Ranked by critical assets in fault, offline gateways, alarms and ACK backlog',
  'Visão geral do período': 'Period overview',
  'Alarmes críticos ativos': 'Active critical alarms',
  'Aguardando ACK': 'Awaiting ACK',
  'Resolvidos': 'Resolved',
  'Disponibilidade': 'Availability',
  'Dispositivos online / total do escopo': 'Online devices / scope total',

  // ── QuickAccess ──
  'Acesso Rápido': 'Quick Access',
  'Atalhos para as principais telas': 'Shortcuts to the main screens',
  'Painel e histórico': 'Panel and history',
  'Telas e sinóticos': 'Screens and synoptics',
  'Gerar PDF': 'Generate PDF',
  'Histórico': 'History',

  // ── SeverityTimelineCard ──
  'Baixa': 'Low',
  'Média': 'Medium',
  'Alta': 'High',
  'Alarmes ao longo do tempo': 'Alarms over time',
  'Alarmes e quedas no período': 'Alarms and drops in the period',
  'Distribuição por severidade no período selecionado':
    'Distribution by severity in the selected period',
  'Alarmes por severidade e quedas de comunicação (todos os clientes ativos)':
    'Alarms by severity and communication drops (all active clients)',
  'Nenhum alarme disparado no período': 'No alarms triggered in the period',
  'Nenhum alarme nem queda de comunicação no período':
    'No alarms or communication drops in the period',
  'Nada registrado na janela selecionada': 'Nothing recorded in the selected window',
  'Alarmes por severidade ao longo do tempo': 'Alarms by severity over time',
  'Alarmes por severidade e quedas de comunicação ao longo do tempo':
    'Alarms by severity and communication drops over time',
  'clique para ver': 'click to view',

  // ── TenantRankingCard ──
  'Atenção por Cliente': 'Attention by Client',
  'Clientes com mais anomalias ativas': 'Clients with the most active anomalies',
  'Tudo em ordem': 'All clear',
  'Nenhum cliente com alarmes ativos ou dispositivos offline':
    'No client with active alarms or offline devices',
  'alarmes': 'alarms',
  'Explorar todos os clientes': 'Explore all clients',
};
