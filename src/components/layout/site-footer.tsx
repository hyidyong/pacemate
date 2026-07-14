import Link from "next/link";
import { BookOpenText, Instagram, Youtube } from "lucide-react";

type SiteFooterProps = {
  hasMobileNav?: boolean;
};

const policyLinks = [
  { href: "#", label: "이용약관" },
  { href: "#", label: "개인정보처리방침", emphasized: true },
  { href: "#", label: "책임의 한계 및 법적고지" },
  { href: "#", label: "청소년보호정책" },
];

const socialLinks = [
  { label: "인스타그램", icon: Instagram },
  { label: "스레드", icon: ThreadsIcon },
  { label: "블로그", icon: BookOpenText },
  { label: "유튜브", icon: Youtube },
];

export function SiteFooter({ hasMobileNav = false }: SiteFooterProps) {
  return (
    <footer className={`site-footer${hasMobileNav ? " site-footer--with-mobile-nav" : ""}`}>
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <section className="site-footer__brand">
            <p className="site-footer__eyebrow">PaceMate Beta</p>
            <h2>substudy</h2>
            <p className="site-footer__lead">
              학습과 진로 탐색을 안정적으로 이어갈 수 있도록 돕는 PaceMate 베타 서비스를 운영하고 있습니다.
            </p>
          </section>

          <section className="site-footer__block">
            <h3>사업자 정보</h3>
            <dl className="site-footer__list">
              <div>
                <dt>대표자명</dt>
                <dd>손희정, 윤성혜</dd>
              </div>
              <div>
                <dt>사업자 등록번호</dt>
                <dd>123-XX-XXXXX</dd>
              </div>
              <div>
                <dt>통신판매업 신고번호</dt>
                <dd>제 2026-대구달서-XXXX 호</dd>
              </div>
              <div>
                <dt>소재지</dt>
                <dd>대구광역시 달서구 달구벌대로 1095 계명대학교 성서캠퍼스 쉐턱관 106호</dd>
              </div>
            </dl>
          </section>

          <section className="site-footer__block">
            <h3>고객센터</h3>
            <dl className="site-footer__list">
              <div>
                <dt>연락처</dt>
                <dd>
                  <a href="tel:010-8028-6655">010-8028-6655</a>
                </dd>
              </div>
              <div>
                <dt>이메일</dt>
                <dd>
                  <a href="mailto:dudn4291@naver.com">dudn4291@naver.com</a>
                </dd>
              </div>
              <div>
                <dt>운영시간</dt>
                <dd>평일 09:00 ~ 17:00</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="site-footer__divider" />

        <div className="site-footer__bottom">
          <nav className="site-footer__policies" aria-label="정책 링크">
            {policyLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`site-footer__policy-link${item.emphasized ? " is-emphasized" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="site-footer__meta">
            <div className="site-footer__socials" aria-label="SNS 링크">
              {socialLinks.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  className="site-footer__social-button"
                  aria-label={label}
                  title={label}
                >
                  <Icon size={18} aria-hidden="true" />
                </button>
              ))}
            </div>

            <p className="site-footer__copyright">
              © 2026 substudy. All rights reserved. All contents copyright reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

function ThreadsIcon({ size = 18, ...props }: React.SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15.6 10.4c-.5-3.2-2.4-4.8-5.7-4.8-3.8 0-6.2 2.3-6.2 6.3 0 4.5 2.9 7 7.3 7 4.2 0 6.8-2.2 6.8-5.6 0-2.8-1.8-4.8-5-5.6 3 .3 5.7 1.7 7 4.2.8 1.6.9 3.4.2 4.9-1.2 2.8-4.4 4.6-8.8 4.6C5 21.4 1.5 17.8 1.5 12c0-5.5 3.5-9.4 8.7-9.4 4.9 0 8 2.6 8.6 7.2" />
      <path d="M10.9 13.7c.8-.4 1.8-.6 2.8-.6 2.1 0 3.6.9 3.6 2.5 0 1.7-1.7 2.8-4.1 2.8-2.2 0-3.8-.9-4.1-2.6" />
    </svg>
  );
}
