export type AgentOs = 'linux' | 'windows';

/**
 * Baixa o pacote .zip do agente de gateway para o sistema operacional escolhido
 * e dispara o download no navegador.
 */
export async function downloadAgentPackage(os: AgentOs): Promise<void> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  // Autenticação via cookie de sessão HttpOnly (enviado pelo browser).
  const res = await fetch(`${API_URL}/gateways/agent-package?os=${os}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bluebee-gateway-agent-${os}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
