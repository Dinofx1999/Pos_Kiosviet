import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PlanService } from '../platform/plan.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService, pickUser } from '../auth/auth.service';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto, UserQueryDto } from './dto/org.dto';

const userInclude = {
  roles: { include: { role: { select: { id: true, code: true, name: true } } } },
  branchAccess: { select: { branchId: true } },
  warehouseAccess: { select: { warehouseId: true } },
} satisfies Prisma.UserInclude;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly plans: PlanService) {}

  private canSalary(actor: RequestUser) { return actor.permissions.has('*') || actor.permissions.has('employee.manage'); }

  async list(actor: RequestUser, q: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status as any } : {}),
      ...(q.roleId ? { roles: { some: { roleId: q.roleId } } } : {}),
      ...(q.search ? { OR: [{ username: { contains: q.search, mode: 'insensitive' } }, { fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.user.findMany({ where, include: userInclude, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'username', 'fullName'], 'createdAt') }),
      this.prisma.db.user.count({ where }),
    ]);
    const salary = this.canSalary(actor);
    return paginated(rows.map((r) => toUserView(r, salary)), total, q);
  }

  async get(actor: RequestUser, id: string) {
    const u = await this.prisma.db.user.findFirst({ where: { id }, include: userInclude });
    if (!u) throw Errors.notFound('Người dùng', id);
    return toUserView(u, this.canSalary(actor));
  }

  async create(actor: RequestUser, dto: CreateUserDto) {
    const dup = await this.prisma.db.user.findFirst({ where: { username: dto.username } });
    if (dup) throw Errors.duplicate('DUPLICATE_USERNAME', 'Tên đăng nhập đã tồn tại', { username: dto.username });
    await this.validateRefs(dto.roleIds, dto.branchIds, dto.warehouseIds);
    const passwordHash = await AuthService.hashPassword(dto.password);
    return this.prisma.tx(async (tx) => {
      await this.plans.assertLimit(tx, actor.tenantId, 'users');
      const user = await tx.user.create({
        data: {
          tenantId: actor.tenantId, username: dto.username, passwordHash, fullName: dto.fullName, email: dto.email, phone: dto.phone, position: dto.position, hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : undefined, baseSalary: dto.baseSalary, employeeNote: dto.employeeNote,
          allBranches: dto.allBranches ?? false,
          roles: { create: (dto.roleIds ?? []).map((roleId) => ({ roleId })) },
          branchAccess: { create: (dto.branchIds ?? []).map((branchId) => ({ branchId })) },
          warehouseAccess: { create: (dto.warehouseIds ?? []).map((warehouseId) => ({ warehouseId })) },
        },
        include: userInclude,
      });
      await this.audit.log(tx, { action: 'user.create', entityType: 'User', entityId: user.id, entityCode: user.username, after: toUserView(user, true) });
      return toUserView(user, this.canSalary(actor));
    });
  }

  async update(actor: RequestUser, id: string, dto: UpdateUserDto) {
    const before = await this.prisma.db.user.findFirst({ where: { id }, include: userInclude });
    if (!before) throw Errors.notFound('Người dùng', id);
    if (before.isOwner && dto.status && dto.status !== 'ACTIVE') throw Errors.conflict('OWNER_PROTECTED', 'Không thể khóa tài khoản chủ gian hàng');
    if (id === actor.id && dto.status && dto.status !== 'ACTIVE') throw Errors.conflict('SELF_PROTECTED', 'Không thể tự khóa tài khoản của mình');
    await this.validateRefs(dto.roleIds, dto.branchIds, dto.warehouseIds);
    return this.prisma.tx(async (tx) => {
      const after = await tx.user.update({
        where: { id },
        data: {
          fullName: dto.fullName, email: dto.email, phone: dto.phone, status: dto.status, allBranches: dto.allBranches, position: dto.position, hiredAt: dto.hiredAt === undefined ? undefined : dto.hiredAt ? new Date(dto.hiredAt) : null, baseSalary: dto.baseSalary, employeeNote: dto.employeeNote,
          ...(dto.roleIds ? { roles: { deleteMany: {}, create: dto.roleIds.map((roleId) => ({ roleId })) } } : {}),
          ...(dto.branchIds ? { branchAccess: { deleteMany: {}, create: dto.branchIds.map((branchId) => ({ branchId })) } } : {}),
          ...(dto.warehouseIds ? { warehouseAccess: { deleteMany: {}, create: dto.warehouseIds.map((warehouseId) => ({ warehouseId })) } } : {}),
        },
        include: userInclude,
      });
      if (dto.status && dto.status !== 'ACTIVE') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { action: 'user.update', entityType: 'User', entityId: id, entityCode: after.username, before: toUserView(before, true), after: toUserView(after, true) });
      return toUserView(after, this.canSalary(actor));
    });
  }

  async resetPassword(actor: RequestUser, id: string, dto: ResetPasswordDto) {
    const user = await this.prisma.db.user.findFirst({ where: { id } });
    if (!user) throw Errors.notFound('Người dùng', id);
    if (user.isOwner && actor.id !== id) throw Errors.conflict('OWNER_PROTECTED', 'Chỉ chủ gian hàng mới đổi được mật khẩu của mình');
    const passwordHash = await AuthService.hashPassword(dto.newPassword);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { action: 'user.reset_password', entityType: 'User', entityId: id, entityCode: user.username });
    });
  }

  private async validateRefs(roleIds?: string[], branchIds?: string[], warehouseIds?: string[]) {
    if (roleIds?.length) {
      const n = await this.prisma.db.role.count({ where: { id: { in: roleIds } } });
      if (n !== new Set(roleIds).size) throw Errors.validation('Vai trò không hợp lệ');
    }
    if (branchIds?.length) {
      const n = await this.prisma.db.branch.count({ where: { id: { in: branchIds } } });
      if (n !== new Set(branchIds).size) throw Errors.validation('Chi nhánh không hợp lệ');
    }
    if (warehouseIds?.length) {
      const n = await this.prisma.db.warehouse.count({ where: { id: { in: warehouseIds } } });
      if (n !== new Set(warehouseIds).size) throw Errors.validation('Kho không hợp lệ');
    }
  }
}

/** `showSalary`: base salary is visible only to people with employee.manage (and in audit logs). */
export function toUserView(u: Prisma.UserGetPayload<{ include: typeof userInclude }>, showSalary = false) {
  return {
    ...pickUser(u),
    position: u.position,
    hiredAt: u.hiredAt,
    employeeNote: u.employeeNote,
    ...(showSalary ? { baseSalary: u.baseSalary } : {}),
    createdAt: u.createdAt,
    roles: u.roles.map((r) => r.role),
    branchIds: u.branchAccess.map((b) => b.branchId),
    warehouseIds: u.warehouseAccess.map((w) => w.warehouseId),
  };
}
