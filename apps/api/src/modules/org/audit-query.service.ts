import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditQueryDto } from './dto/org.dto';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async auditLogs(q: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ entityCode: { contains: q.search, mode: 'insensitive' } }, { username: { contains: q.search, mode: 'insensitive' } }, { action: { contains: q.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({ where, ...skipTake(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async loginHistory(q: AuditQueryDto) {
    const where: Prisma.LoginHistoryWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.search ? { username: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.loginHistory.findMany({ where, ...skipTake(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.db.loginHistory.count({ where }),
    ]);
    return paginated(rows, total, q);
  }
}
