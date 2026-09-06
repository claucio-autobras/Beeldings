import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../domain/interfaces/auth.interface.js';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
