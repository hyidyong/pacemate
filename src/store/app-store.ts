import { create } from "zustand";

// ─── 타입 정의 ───────────────────────────────────────────────
export type MobileTab = "home" | "roadmap" | "chat" | "mypage";

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  last_message?: string;
};

interface AppState {
  // 현재 활성 탭
  activeTab: MobileTab;
  setActiveTab: (tab: MobileTab) => void;

  // AI 튜터 채팅 상태
  activeChatSessionId: string | null;
  setActiveChatSessionId: (id: string | null) => void;
  cachedSessions: ChatSession[];
  setCachedSessions: (sessions: ChatSession[]) => void;
  isChatSidebarOpen: boolean;
  setIsChatSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // 탭 상태
  activeTab: "home",
  setActiveTab: (tab) => set({ activeTab: tab }),

  // 채팅 상태
  activeChatSessionId: null,
  setActiveChatSessionId: (id) => set({ activeChatSessionId: id }),
  cachedSessions: [],
  setCachedSessions: (sessions) => set({ cachedSessions: sessions }),
  isChatSidebarOpen: false,
  setIsChatSidebarOpen: (open) => set({ isChatSidebarOpen: open }),
}));
