"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  notificationCategoryLabels,
  type UserNotification,
} from "@/services/notifications.service";
import { markNotificationAsRead } from "@/services/notifications.actions";
import { useAppStore } from "@/store/app-store";

type NotificationStripProps = {
  notifications: UserNotification[];
};

export function NotificationStrip({ notifications: initialNotifications }: NotificationStripProps) {
  const router = useRouter();
  const { addTimetableItem } = useAppStore();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [selectedNotification, setSelectedNotification] = useState<UserNotification | null>(null);

  if (!notifications.length) {
    return null;
  }

  const handleNotificationClick = async (notification: UserNotification) => {
    // 즉시 로컬 상태 업데이트 (빨간점/New 제거)
    if (!notification.is_read) {
      setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n));
      // 서버 상태 업데이트 (백그라운드)
      markNotificationAsRead(notification.id);
    }

    if (notification.category === "counseling") {
      // 상담 관련 알림은 상세 모달 띄우기
      setSelectedNotification(notification);
    } else {
      // 일반 알림은 해당 페이지로 이동
      router.push(notification.target_href);
    }
  };

  const handleConfirmCounseling = () => {
    if (selectedNotification) {
      // 상담 일정을 오늘의 시간표에 추가
      addTimetableItem({
        id: Date.now(),
        name: "상담: " + selectedNotification.title.replace("상담 신청이 승인되었습니다", "").trim(),
        time: "15:00 - 15:30", // 예시 시간
        room: "교수 연구실",
        color: "bg-purple-100 text-purple-700"
      });
      setSelectedNotification(null);
    }
  };

  return (
    <>
      <section className="section notification-strip" aria-label="알림 요약">
        <div className="notification-strip-heading">
          <span className="icon-box">
            <Bell aria-hidden="true" />
          </span>
          <div>
            <h2>확인할 알림</h2>
            <p>최근 알림 {notifications.length}개가 있습니다. 전체 알림함에서 카테고리별로 볼 수 있어요.</p>
          </div>
          <Link className="notification-strip-link" href="/notifications">
            전체 보기
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
        <div className="notification-list grid gap-2 mt-3">
          {notifications.slice(0, 3).map((notification) => (
            <motion.div
              key={notification.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleNotificationClick(notification)}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 cursor-pointer hover:border-emerald-200 transition-colors relative flex items-center justify-between group"
            >
              <div className="flex flex-col gap-1 pr-6">
                <div className="flex items-center">
                  <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                    {notificationCategoryLabels[notification.category]}
                  </span>
                  {!notification.is_read && (
                    <span className="text-green-500 text-[10px] font-bold ml-2 animate-pulse">New</span>
                  )}
                </div>
                <strong className="text-sm text-gray-800 line-clamp-1 mt-1">{notification.title}</strong>
                <p className="text-xs text-gray-500 line-clamp-1">{notification.body}</p>
              </div>
              <ChevronRight className="text-gray-300 group-hover:text-emerald-500 transition-colors" size={18} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* 상담 상세 모달 */}
      <AnimatePresence>
        {selectedNotification && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedNotification(null)}
              className="fixed inset-0 bg-black z-[110]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[400px] bottom-10 md:bottom-auto md:top-1/2 md:-translate-y-1/2 bg-white rounded-3xl p-6 z-[120] shadow-2xl"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-gray-800">알림 상세</h3>
                <button onClick={() => setSelectedNotification(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
              
              <div className="bg-gray-50 rounded-2xl p-5 mb-6">
                <div className="text-[11px] font-semibold text-emerald-600 mb-2">
                  {notificationCategoryLabels[selectedNotification.category]}
                </div>
                <h4 className="font-bold text-gray-800 text-[15px] mb-2">{selectedNotification.title}</h4>
                <p className="text-sm text-gray-600 leading-relaxed">{selectedNotification.body}</p>
              </div>

              {selectedNotification.category === "counseling" && (
                <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl text-xs mb-6">
                  <strong className="block mb-1">안내사항</strong>
                  상담 일정이 시간표에 추가됩니다. 정해진 시간에 늦지 않게 참석해주세요.
                </div>
              )}

              <div className="flex gap-3">
                <button 
                  onClick={handleConfirmCounseling}
                  className="w-full py-3.5 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
