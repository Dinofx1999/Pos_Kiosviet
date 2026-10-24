import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { hasPermission } from '@erp/shared';
import type { Me } from '../api/types';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  me: Me | null;
  currentBranchId: string | null;
  setTokens: (access: string, refresh: string) => void;
  setMe: (me: Me) => void;
  setBranch: (id: string) => void;
  logout: () => void;
  can: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      me: null,
      currentBranchId: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setMe: (me) => {
        const cur = get().currentBranchId;
        const valid = me.branches.some((b) => b.id === cur);
        set({ me, currentBranchId: valid ? cur : (me.branches.find((b) => b.isDefault) ?? me.branches[0])?.id ?? null });
      },
      setBranch: (currentBranchId) => set({ currentBranchId }),
      logout: () => set({ accessToken: null, refreshToken: null, me: null }),
      can: (code) => {
        const me = get().me;
        return !!me && hasPermission(me.permissions, code);
      },
    }),
    { name: 'erp-auth', partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, currentBranchId: s.currentBranchId, me: s.me }) },
  ),
);

export const useCan = () => useAuthStore((s) => s.can);
export const useMe = () => useAuthStore((s) => s.me);
/** Warehouses of the currently selected branch (falls back to all accessible). */
export const useBranchWarehouses = () => {
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const list = me?.warehouses ?? [];
  const filtered = branchId ? list.filter((w) => w.branchId === branchId) : list;
  return filtered.length ? filtered : list;
};
