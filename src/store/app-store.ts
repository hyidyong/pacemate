import { create } from "zustand";

// ─── 타입 정의 ───────────────────────────────────────────────
export type MobileTab = "home" | "roadmap" | "chat" | "mypage";

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  last_message?: string;
};

export type TimetableItem = {
  id: string | number;
  name: string;
  time: string;
  room: string;
  color: string;
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

  // 시간표 상태 및 모달
  timetableItems: TimetableItem[];
  addTimetableItem: (item: TimetableItem) => void;
  isTimetableModalOpen: boolean;
  setIsTimetableModalOpen: (open: boolean) => void;
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

  // 시간표 상태 및 모달
  timetableItems: [
    { id: 1, name: "고급웹프로그래밍", time: "09:00 - 10:30", room: "공학관 201호", color: "bg-blue-100 text-blue-700" },
    { id: 2, name: "데이터베이스", time: "11:00 - 12:15", room: "정보관 304호", color: "bg-emerald-100 text-emerald-700" },
  ],
  addTimetableItem: (item) => set((state) => ({ timetableItems: [...state.timetableItems, item] })),
  isTimetableModalOpen: false,
  setIsTimetableModalOpen: (open) => set({ isTimetableModalOpen: open }),
}));
