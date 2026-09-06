import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getClientIp } from '../modules/audit/audit.util.js';

/**
 * Guard global de rate limiting por IP.
 *
 * - Aplica-se apenas ao contexto HTTP: eventos WebSocket (Socket.IO de
 *   telemetria) e demais contextos passam direto — a telemetria em tempo real
 *   tem volume alto e legítimo e não deve ser limitada aqui.
 * - O tracker usa o mesmo `getClientIp` da trilha de auditoria (prefere o
 *   primeiro IP de `x-forwarded-for`), pois atrás do proxy do Next/Replit o
 *   `req.ip` costuma ser loopback — sem isso, todos os clientes compartilhariam
 *   um único balde de rate limit.
 */
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return getClientIp(req as any) ?? (req.ip as string) ?? 'unknown';
  }
}
