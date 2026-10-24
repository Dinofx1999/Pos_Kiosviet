import { ClsService } from 'nestjs-cls';

export interface RequestUser {
  id: string;
  tenantId: string;
  username: string;
  fullName: string;
  isOwner: boolean;
  allBranches: boolean;
  permissions: Set<string>;
  branchIds: string[];      // accessible branches (empty + allBranches=false => none)
  warehouseIds: string[];   // explicit warehouse restrictions (empty => all warehouses of accessible branches)
}

export interface RequestContext {
  tenantId?: string;
  user?: RequestUser;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /** When true, the tenant extension does not inject tenant filters (platform/system jobs only). */
  bypassTenant?: boolean;
}

export const CTX = {
  tenantId: 'tenantId',
  user: 'user',
  ip: 'ip',
  userAgent: 'userAgent',
  requestId: 'requestId',
  bypassTenant: 'bypassTenant',
} as const;

export function getCtx(cls: ClsService): RequestContext {
  return {
    tenantId: cls.get(CTX.tenantId),
    user: cls.get(CTX.user),
    ip: cls.get(CTX.ip),
    userAgent: cls.get(CTX.userAgent),
    requestId: cls.get(CTX.requestId),
    bypassTenant: cls.get(CTX.bypassTenant),
  };
}
