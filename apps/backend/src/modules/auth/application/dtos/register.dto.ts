import { UserRole } from '../../domain/interfaces/auth.interface.js';

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  tenantId?: string;
}
