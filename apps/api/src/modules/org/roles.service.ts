import { Injectable } from '@nestjs/common';
import { ALL_PERMISSION_CODES, PERMISSIONS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/org.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  permissionCatalog() {
    const groups: Record<string, Array<{ code: string; label: string }>> = {};
    for (const code of ALL_PERMISSION_CODES) {
      const def = PERMISSIONS[code];
      (groups[def.group] ??= []).push({ code, label: def.label });
    }
    return Object.entries(groups).map(([group, permissions]) => ({ group, permissions }));
  }

  async list() {
    const roles = await this.prisma.db.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    return roles.map(toRoleView);
  }

  async get(id: string) {
    const role = await this.prisma.db.role.findFirst({ where: { id }, include: { permissions: true, _count: { select: { users: true } } } });
    if (!role) throw Errors.notFound('Vai trò', id);
    return toRoleView(role);
  }

  async create(actor: RequestUser, dto: CreateRoleDto) {
    this.validatePermissions(dto.permissions);
    const dup = await this.prisma.db.role.findFirst({ where: { code: dto.code } });
    if (dup) throw Errors.duplicate('DUPLICATE_CODE', 'Mã vai trò đã tồn tại', { code: dto.code });
    return this.prisma.tx(async (tx) => {
      const role = await tx.role.create({
        data: { tenantId: actor.tenantId, code: dto.code, name: dto.name, description: dto.description, permissions: { create: uniq(dto.permissions).map((permission) => ({ permission })) } },
        include: { permissions: true, _count: { select: { users: true } } },
      });
      await this.audit.log(tx, { action: 'role.create', entityType: 'Role', entityId: role.id, entityCode: role.code, after: toRoleView(role) });
      return toRoleView(role);
    });
  }

  async update(actor: RequestUser, id: string, dto: UpdateRoleDto) {
    const before = await this.prisma.db.role.findFirst({ where: { id }, include: { permissions: true, _count: { select: { users: true } } } });
    if (!before) throw Errors.notFound('Vai trò', id);
    if (before.isSystem && dto.permissions) throw Errors.conflict('ROLE_SYSTEM', 'Không thể sửa quyền của vai trò hệ thống');
    if (dto.permissions) this.validatePermissions(dto.permissions);
    return this.prisma.tx(async (tx) => {
      const after = await tx.role.update({
        where: { id },
        data: { name: dto.name, description: dto.description, ...(dto.permissions ? { permissions: { deleteMany: {}, create: uniq(dto.permissions).map((permission) => ({ permission })) } } : {}) },
        include: { permissions: true, _count: { select: { users: true } } },
      });
      await this.audit.log(tx, { action: 'role.update', entityType: 'Role', entityId: id, entityCode: after.code, before: toRoleView(before), after: toRoleView(after) });
      return toRoleView(after);
    });
  }

  async remove(actor: RequestUser, id: string) {
    const role = await this.prisma.db.role.findFirst({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw Errors.notFound('Vai trò', id);
    if (role.isSystem) throw Errors.conflict('ROLE_SYSTEM', 'Không thể xóa vai trò hệ thống');
    if (role._count.users > 0) throw Errors.conflict('ROLE_IN_USE', 'Vai trò đang được gán cho người dùng', { users: role._count.users });
    await this.prisma.tx(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.log(tx, { action: 'role.delete', entityType: 'Role', entityId: id, entityCode: role.code, before: role });
    });
  }

  private validatePermissions(codes: string[]) {
    const valid = new Set<string>([...ALL_PERMISSION_CODES, '*']);
    const invalid = codes.filter((c) => !valid.has(c) && !(c.endsWith('.*') && ALL_PERMISSION_CODES.some((p) => p.startsWith(c.slice(0, -1)))));
    if (invalid.length) throw Errors.validation('Permission không hợp lệ', { invalid });
  }
}

const uniq = (a: string[]) => Array.from(new Set(a));
function toRoleView(r: { id: string; code: string; name: string; description: string | null; isSystem: boolean; permissions: { permission: string }[]; _count: { users: number }; createdAt?: Date }) {
  return { id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permission), userCount: r._count.users, createdAt: r.createdAt };
}
