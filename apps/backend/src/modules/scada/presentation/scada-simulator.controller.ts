import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  SimulatorService,
  type NewVirtualPointDto,
  type VirtualDeviceView,
} from '../application/simulator.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

interface EnsureDeviceDto {
  projectId: string;
  /** Informado pelo frontend; o tenant efetivo é resolvido a partir do projeto. */
  tenantId?: string;
}

interface AddPointsDto {
  points: NewVirtualPointDto[];
}

interface SetValueDto {
  value: number | boolean;
}

/**
 * Bancada de Testes do SCADA (pontos virtuais). Isolado por tenant via projeto;
 * gestão estrutural (ensure/addPoints/deletePoint) exige perfil global, enquanto
 * o comando de valor (setValue) também aceita CLIENTE do tenant do projeto —
 * mesma regra dos writes BACnet/MQTT/Modbus.
 */
@Controller('scada/simulator')
@UseGuards(JwtAuthGuard)
export class ScadaSimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Post('/ensure')
  @HttpCode(HttpStatus.OK)
  async ensure(
    @Body() body: EnsureDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VirtualDeviceView> {
    return this.simulator.ensureDevice(body.projectId, user);
  }

  @Get('/devices')
  async listDevices(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VirtualDeviceView[]> {
    return this.simulator.listDevices(projectId, user);
  }

  @Post('/:deviceId/points')
  @HttpCode(HttpStatus.OK)
  async addPoints(
    @Param('deviceId') deviceId: string,
    @Body() body: AddPointsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VirtualDeviceView> {
    return this.simulator.addPoints(deviceId, body.points, user);
  }

  @Patch('/:deviceId/points/:pointId/value')
  async setValue(
    @Param('deviceId') deviceId: string,
    @Param('pointId') pointId: string,
    @Body() body: SetValueDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VirtualDeviceView> {
    return this.simulator.setPointValue(deviceId, pointId, body.value, user);
  }

  @Delete('/:deviceId/points/:pointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePoint(
    @Param('deviceId') deviceId: string,
    @Param('pointId') pointId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.simulator.deletePoint(deviceId, pointId, user);
  }
}
