import { useEffect } from 'react';
import { create } from 'zustand';

interface LayoutState { fullscreen: number; push: () => void; pop: () => void }
/** Số màn "toàn trang" đang mở (chi tiết hóa đơn, trả hàng…): khi > 0 khung điện thoại ẩn thanh tiêu đề cửa hàng và thanh tab dưới. */
export const useLayoutStore = create<LayoutState>()((set) => ({
  fullscreen: 0,
  push: () => set((s) => ({ fullscreen: s.fullscreen + 1 })),
  pop: () => set((s) => ({ fullscreen: Math.max(0, s.fullscreen - 1) })),
}));

/** Màn có thanh tiêu đề riêng (‹ quay lại, ⋯) như app KiotViet – gọi ở đầu component, chỉ có tác dụng trên điện thoại. */
export function useFullscreenPage(on = true) {
  const push = useLayoutStore((s) => s.push);
  const pop = useLayoutStore((s) => s.pop);
  useEffect(() => { if (!on) return; push(); return () => pop(); }, [on, push, pop]);
}
