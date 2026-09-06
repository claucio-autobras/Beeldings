// ─── CFTV — visualização ao vivo (modal compartilhado CFTV/SCADA) ────────────
export const DICT_CFTV: Record<string, string> = {
  'Ver ao vivo': 'View live',
  'AO VIVO': 'LIVE',
  'último frame às': 'last frame at',
  'Fechar': 'Close',
  'Conectando à câmera…': 'Connecting to camera…',
  'A primeira imagem pode levar alguns segundos.':
    'The first image may take a few seconds.',
  'Sinal perdido': 'Signal lost',
  'A câmera parou de enviar imagens. Verifique a conexão da câmera ou do gateway.':
    'The camera stopped sending images. Check the camera or gateway connection.',
  'Tentar de novo': 'Try again',
  'Visualização não suportada': 'Live view not supported',
  'Esta câmera não expõe um método de captura de imagem compatível (snapshot ONVIF ou stream RTSP).':
    'This camera does not expose a compatible image capture method (ONVIF snapshot or RTSP stream).',
  'Não foi possível exibir a imagem': 'Could not display the image',
  'Falha ao obter imagens da câmera. Verifique o gateway e as credenciais ONVIF.':
    'Failed to fetch images from the camera. Check the gateway and the ONVIF credentials.',
  'Imagem quase em tempo real (~1–2 quadros por segundo).':
    'Near real-time image (~1–2 frames per second).',
  'Fechar encerra a transmissão.': 'Closing ends the stream.',
  'Disponível apenas para câmeras ONVIF': 'Available only for ONVIF cameras',
  'Disponível quando a câmera estiver online': 'Available when the camera is online',

  // ── Perfil de monitoramento ──────────────────────────────────────────────────
  'Perfil de monitoramento': 'Monitoring profile',
  'Identificar perfil': 'Identify profile',
  'Identificando…': 'Identifying…',
  'Perfil detectado automaticamente': 'Profile automatically detected',
  'Perfil selecionado manualmente': 'Profile manually selected',
  'Sem perfil específico (genérico)': 'No specific profile (generic)',
  'Detectado': 'Detected',
  'Manual': 'Manual',
  'Genérico': 'Generic',
  'Suportada': 'Supported',
  'Não suportada': 'Not supported',
  'Sem permissão SNMP': 'No SNMP permission',
  'Erro temporário': 'Temporary error',
  'Câmera não respondeu ao SNMP (community errada ou SNMP desabilitado)':
    'Camera did not respond to SNMP (wrong community or SNMP disabled)',
  'Falha de rede ou timeout — retry no próximo probe':
    'Network error or timeout — retry on next probe',
  'Selecione um perfil…': 'Select a profile…',
  'Usar detecção automática': 'Use automatic detection',
  'Probe executado com sucesso': 'Probe executed successfully',
  'A câmera não respondeu ao SNMP': 'The camera did not respond to SNMP',
  'Capacidades': 'Capabilities',
  'Probe falhou': 'Probe failed',
};
