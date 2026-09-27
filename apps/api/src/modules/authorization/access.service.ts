import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { forbidden } from '../../common/errors';
import type { AuthUser } from '../auth/auth.types';
import { toPermissions } from './permissions';

export type EmployeeScope = { all: true } | { all: false; ids: string[] };

/**
 * Attribute-based data scoping from role assignments:
 *  - role with `report.all.read`, unscoped            → whole company
 *  - role with a report permission, scoped to unit X   → X and all its sub-units
 *  - role with `report.team.read`, unscoped            → units the user manages (org_unit.manager_id)
 *  - otherwise                                         → only yourself
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async reportScope(user: AuthUser): Promise<EmployeeScope> {
    if (!user.permissions.includes('report.all.read') && !user.permissions.includes('report.team.read')) {
      return { all: false, ids: [user.id] };
    }
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { employeeId: user.id },
      select: { orgUnitId: true, role: { select: { permissions: true } } },
    });
    const roots = new Set<string>();
    let managedFallback = false;
    for (const a of assignments) {
      const perms = toPermissions(a.role.permissions);
      const all = perms.includes('report.all.read');
      const team = perms.includes('report.team.read');
      if (!all && !team) continue;
      if (a.orgUnitId) roots.add(a.orgUnitId);
      else if (all) return { all: true };
      else managedFallback = true;
    }

    const units = await this.prisma.orgUnit.findMany({ select: { id: true, parentId: true, managerId: true } });
    if (managedFallback) units.filter((u) => u.managerId === user.id).forEach((u) => roots.add(u.id));
    const scope = new Set(roots);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of units) {
        if (u.parentId && scope.has(u.parentId) && !scope.has(u.id)) {
          scope.add(u.id);
          grew = true;
        }
      }
    }
    const members = scope.size
      ? await this.prisma.employee.findMany({ where: { orgUnitId: { in: [...scope] } }, select: { id: true } })
      : [];
    return { all: false, ids: [...new Set([user.id, ...members.map((m) => m.id)])] };
  }

  /** Prisma `where` fragment restricting an employeeId column to the scope. */
  employeeFilter(scope: EmployeeScope): { in: string[] } | undefined {
    return scope.all ? undefined : { in: scope.ids };
  }

  async assertCanRead(user: AuthUser, employeeId: string): Promise<void> {
    if (employeeId === user.id) return;
    const scope = await this.reportScope(user);
    if (!scope.all && !scope.ids.includes(employeeId)) throw forbidden('ไม่มีสิทธิ์ดูข้อมูลของพนักงานคนนี้');
  }
}
