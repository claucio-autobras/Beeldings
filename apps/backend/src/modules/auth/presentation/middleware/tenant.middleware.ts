import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../../domain/interfaces/auth.interface.js';

interface RequestWithTenant extends Request {
  tenantId?: string | null;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  use(req: RequestWithTenant, _res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const secret = this.config.getOrThrow<string>('JWT_SECRET');
        const payload = this.jwt.verify<JwtPayload>(token, { secret });
        req.tenantId = payload.tenantId ?? null;
      } catch {
        // Token inválido — deixa o guard tratar
        req.tenantId = null;
        this.logger.debug('TenantMiddleware: token inválido ou ausente');
      }
    } else {
      req.tenantId = null;
    }

    next();
  }
}
