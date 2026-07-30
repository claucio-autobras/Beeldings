import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';

/**
 * Módulo da trilha de auditoria. Global para que o AuditService possa ser
 * injetado em qualquer módulo (ex.: AuthService para login). O interceptor é
 * registrado como APP_INTERCEPTOR e, portanto, aplica-se a TODAS as rotas.
 */
@Global()
@Module({
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
