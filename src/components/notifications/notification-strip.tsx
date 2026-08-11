"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  notificationCategoryLabels,
  type UserNotification,
} from "@/types/notifications";
import { markNotificationAsRead } from "@/services/notifications.actions";

type NotificationStripProps = {
  notifications: UserNotification[];
  showSummary?: boolean;
};

export function NotificationStrip({ notifications: initialNotifications, showSummary = true }: NotificationStripProps) {
  const router = useRouter();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [selectedNotification, setSelectedNotification] = useState<UserNotification | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const visibleNotifications = notifications.slice(0, 3);

  const updateScrollControls = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const nextCanScrollLeft = container.scrollLeft > 1;
    const nextCanScrollRight = container.scrollLeft < maxScrollLeft - 1;

    setCanScrollLeft(previous => previous === nextCanScrollLeft ? previous : nextCanScrollLeft);
    setCanScrollRight(previous => previous === nextCanScrollRight ? previous : nextCanScrollRight);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    updateScrollControls();
    container.addEventListener("scroll", updateScrollControls, { passive: true });
    window.addEventListener("resize", updateScrollControls);

    return () => {
      container.removeEventListener("scroll", updateScrollControls);
      window.removeEventListener("resize", updateScrollControls);
    };
  }, [updateScrollControls, visibleNotifications.length]);

  const scrollNotifications = (direction: "previous" | "next") => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const firstCard = container.querySelector<HTMLElement>("[data-notification-card]");
    const cardGap = 12;
    const distance = firstCard
      ? firstCard.offsetWidth + cardGap
      : container.clientWidth * 0.9;

    container.scrollBy({
      left: direction === "next" ? distance : -distance,
      behavior: "smooth",
    });
  };

  if (!notifications.length) {
    return null;
  }

  const handleNotificationClick = async (notification: UserNotification) => {
    if (!notification.is_read) {
      setNotifications(previous => previous.map(item =>
        item.id === notification.id ? { ...item, is_read: true } : item,
      ));
      markNotificationAsRead(notification.id);
    }

    if (notification.category === "counseling") {
      setSelectedNotification(notification);
    } else {
      router.push(notification.target_href);
    }
  };

  const handleConfirmCounseling = () => {
    if (selectedNotification) {
      // The old handler pushed a hardcoded slot into a store no view reads.
      // The confirmed schedule lives on /counseling, so go there instead.
      const target = selectedNotification.target_href || "/counseling";
      setSelectedNotification(null);
      router.push(target);
    }
  };

  const showScrollControls = visibleNotifications.length > 1;

  return (
    <>
      <section className="section notification-strip" aria-label="알림 요약">
        <div className="notification-strip-heading">
          <span className="icon-box">
            <Bell aria-hidden="true" />
          </span>
          <div className="notification-strip-copy">
            <h2>확인할 알림</h2>
            {showSummary ? <p>최근 알림 {notifications.length}개가 있습니다.</p> : null}
          </div>
          <Link className="notification-strip-link" href="/notifications">
            전체 보기
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>

        <div className="notification-carousel">
          <div
            ref={scrollContainerRef}
            className="notification-list notification-scroll"
            onScroll={updateScrollControls}
          >
            {visibleNotifications.map(notification => (
              <button
                key={notification.id}
                type="button"
                data-notification-card
                onClick={() => handleNotificationClick(notification)}
                aria-label={`${notification.title} 알림 열기`}
                className="notification-card group"
              >
                <span className="notification-card-content">
                  <span className="notification-card-meta">
                    <span className="notification-card-category">
                      {notificationCategoryLabels[notification.category]}
                    </span>
                    {!notification.is_read && <span className="notification-card-new">New</span>}
                  </span>
                  <strong>{notification.title}</strong>
                  <span className="notification-card-body">{notification.body}</span>
                </span>
                <ChevronRight aria-hidden="true" className="notification-card-chevron" size={18} />
              </button>
            ))}
          </div>

          {showScrollControls && (
            <div className="notification-scroll-controls" aria-label="알림 목록 이동">
              <button
                type="button"
                onClick={() => scrollNotifications("previous")}
                disabled={!canScrollLeft}
                aria-label="이전 알림 보기"
              >
                <ChevronLeft aria-hidden="true" size={18} />
              </button>
              <button
                type="button"
                onClick={() => scrollNotifications("next")}
                disabled={!canScrollRight}
                aria-label="다음 알림 보기"
              >
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            </div>
          )}
        </div>
      </section>

      {selectedNotification && (
          <>
            <div
              onClick={() => setSelectedNotification(null)}
              className="fixed inset-0 bg-black z-[110]"
            />
            <div
              className="fixed left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[400px] bottom-10 md:bottom-auto md:top-1/2 md:-translate-y-1/2 bg-white rounded-3xl p-6 z-[120] shadow-2xl"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-gray-800">알림 상세</h3>
                <button type="button" onClick={() => setSelectedNotification(null)} className="text-gray-400 hover:text-gray-600">
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
                  상담 일정을 시간표에 추가합니다. 정해진 시간에 맞춰 참석해 주세요.
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleConfirmCounseling}
                  className="w-full py-3.5 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                >
                  확인
                </button>
              </div>
            </div>
          </>
      )}
    </>
  );
}
