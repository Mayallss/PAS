import type { Permission } from '../authorization/permissions';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string | null;
  /** Role keys, e.g. ["EMPLOYEE", "MANAGER"] (for display; checks use `permissions`). */
  roles: string[];
  permissions: Permission[];
  orgUnitId: string | null;
}
