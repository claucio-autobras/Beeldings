import { useMutation } from '@tanstack/react-query';
import { sendBacnetCommand, type SendBacnetCommandParams } from '../services/commands.service';

/**
 * Mutation para enviar um comando de escrita BACnet.
 * Retorna o estado (isPending / error / data) para a UI exibir o resultado.
 */
export function useSendCommand() {
  return useMutation({
    mutationFn: (params: SendBacnetCommandParams) => sendBacnetCommand(params),
  });
}
