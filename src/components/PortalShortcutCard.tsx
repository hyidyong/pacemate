import { studentPortalLinks, type PortalLink } from "@/data/portal-links";

type PortalShortcutGridProps = {
  links: readonly PortalLink[];
};

type PortalShortcutCardProps = {
  links?: readonly PortalLink[];
  title?: string;
  description?: string;
  headingId?: string;
  className?: string;
};

export function PortalShortcutGrid({ links }: PortalShortcutGridProps) {
  return (
    <div className="portal-shortcut-grid">
      {links.map((link) => {
        const Icon = link.Icon;
        const mobileName = link.mobileName ?? link.name;

        return (
          <a
            key={link.id}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="portal-shortcut-link"
            aria-label={link.name}
            title={link.name}
          >
            <span className="portal-shortcut-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={2.25} />
            </span>
            <span className="portal-shortcut-copy">
              <strong className="portal-shortcut-name">
                <span className="portal-shortcut-name-full">{link.name}</span>
                <span className="portal-shortcut-name-mobile">{mobileName}</span>
              </strong>
              <span className="portal-shortcut-description">{link.description}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

export default function PortalShortcutCard({
  links = studentPortalLinks,
  title = "포털 바로가기",
  description = "학사, 비교과, 도서관 서비스를 한 번에 확인해요.",
  headingId = "portal-shortcut-title",
  className = "",
}: PortalShortcutCardProps) {
  return (
    <section
      className={`portal-shortcut-card ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div className="portal-shortcut-header">
        <div className="min-w-0">
          <h2 id={headingId} className="portal-shortcut-title">
            {title}
          </h2>
          {description ? (
            <p className="portal-shortcut-subtitle">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      <PortalShortcutGrid links={links} />
    </section>
  );
}
