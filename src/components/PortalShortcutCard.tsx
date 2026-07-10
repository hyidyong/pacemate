import type { CSSProperties } from "react";

const portalLinks = [
  {
    name: "학교 홈페이지",
    description: "학교 대표 홈페이지와 주요 공지 확인",
    href: "https://www.gokmu.ac.kr/main.htm",
    icon: "🏫",
  },
  {
    name: "교수학습지원센터",
    description: "학습지원 프로그램과 교수학습 자료 확인",
    href: "https://ctl.kmu.ac.kr/index.jsp",
    icon: "📚",
  },
  {
    name: "동산 도서관",
    description: "도서 검색, 전자자료, 열람실 정보 확인",
    href: "https://library.kmu.ac.kr/",
    icon: "📖",
  },
  {
    name: "Story+",
    description: "비교과 프로그램, 상담, 포트폴리오 확인",
    href: "https://story.kmu.ac.kr/main.do",
    icon: "✨",
  },
  {
    name: "에드워드 시스템",
    description: "학사정보, 수강, 성적, 학적 서비스 확인",
    href: "https://edward.kmu.ac.kr/",
    icon: "🧭",
  },
];

const cardStyle: CSSProperties = {
  borderRadius: "24px",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(255, 255, 255, 0.82)",
  boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  padding: "22px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  marginBottom: "16px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "20px",
  fontWeight: 800,
  color: "#0f172a",
};

const subtitleStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "#64748b",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const linkStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "flex-start",
  minHeight: "92px",
  padding: "14px",
  borderRadius: "18px",
  border: "1px solid rgba(148, 163, 184, 0.2)",
  background: "rgba(248, 250, 252, 0.88)",
  color: "inherit",
  textDecoration: "none",
  transition: "transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease",
};

const iconStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "36px",
  height: "36px",
  flex: "0 0 36px",
  borderRadius: "13px",
  background: "rgba(20, 184, 166, 0.12)",
  fontSize: "19px",
};

const nameStyle: CSSProperties = {
  display: "block",
  fontSize: "15px",
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: "5px",
};

const descStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  lineHeight: 1.45,
  color: "#64748b",
};

export default function PortalShortcutCard() {
  return (
    <section style={cardStyle} aria-labelledby="portal-shortcut-title">
      <div style={headerStyle}>
        <div>
          <h2 id="portal-shortcut-title" style={titleStyle}>
            포탈 바로가기
          </h2>
          <p style={subtitleStyle}>
            학사, 비교과, 도서관 서비스를 한 번에 확인해요.
          </p>
        </div>
      </div>

      <div style={gridStyle}>
        {portalLinks.map((link) => (
          <a
            key={link.name}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            <span style={iconStyle} aria-hidden="true">
              {link.icon}
            </span>
            <span>
              <strong style={nameStyle}>{link.name}</strong>
              <p style={descStyle}>{link.description}</p>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
