import type { ReactNode } from 'react';
import { useCan } from '../store/auth';

/** Renders children only when the current user has ALL given permission codes. */
export function PermissionGate({ perm, children, fallback = null }: { perm: string | string[]; children: ReactNode; fallback?: ReactNode }) {
  const can = useCan();
  const codes = Array.isArray(perm) ? perm : [perm];
  return codes.every((c) => can(c)) ? <>{children}</> : <>{fallback}</>;
}
