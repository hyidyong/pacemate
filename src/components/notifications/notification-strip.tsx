import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import {
  notificationCategoryLabels,
  type UserNotification,
} from "@/services/notifications.service";

type NotificationStripProps = {
  notifications: UserNotification[];
};

export function NotificationStrip({ notifications }: NotificationStripProps) {
  if (!notifications.length) {
    return null;
  }

  return (
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
      <div className="notification-list">
        {notifications.slice(0, 2).map((notification) => (
          <Link href={notification.target_href} key={notification.id}>
            <span>{notificationCategoryLabels[notification.category]}</span>
            <strong>{notification.title}</strong>
            <p>{notification.body}</p>
            <ChevronRight aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
