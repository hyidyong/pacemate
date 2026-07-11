"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { CalendarDays, Clock3, ExternalLink, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

export type DashboardSection = "all" | "timetable" | "todo" | "portal" | "academic";

type SectionTab = {
  id: DashboardSection;
  label: string;
  Icon?: ComponentType<{ "aria-hidden"?: boolean; size?: number }>;
  mobileLabel: string;
};

const sectionTabs: ReadonlyArray<SectionTab> = [
  { id: "all", label: "전체", mobileLabel: "All" },
  { id: "timetable", label: "오늘 시간표", mobileLabel: "오늘 시간표", Icon: Clock3 },
  { id: "todo", label: "오늘 To-do", mobileLabel: "오늘 To-do", Icon: ListChecks },
  { id: "portal", label: "포털 바로가기", mobileLabel: "포털 바로가기", Icon: ExternalLink },
  { id: "academic", label: "학사일정", mobileLabel: "학사일정", Icon: CalendarDays },
];

type DashboardSectionTabsProps = {
  activeSection: DashboardSection;
  onChange: (section: DashboardSection) => void;
  panelId: string;
  tabIdPrefix: string;
};

export function DashboardSectionTabs({
  activeSection,
  onChange,
  panelId,
  tabIdPrefix,
}: DashboardSectionTabsProps) {
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateMobileOverflow = useCallback(() => {
    const container = mobileScrollRef.current;

    if (!container) {
      return;
    }

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const nextCanScrollLeft = container.scrollLeft > 1;
    const nextCanScrollRight = maxScrollLeft > 1 && container.scrollLeft < maxScrollLeft - 1;

    setCanScrollLeft(previous => previous === nextCanScrollLeft ? previous : nextCanScrollLeft);
    setCanScrollRight(previous => previous === nextCanScrollRight ? previous : nextCanScrollRight);
  }, []);

  useEffect(() => {
    const container = mobileScrollRef.current;

    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(updateMobileOverflow);
    resizeObserver.observe(container);
    updateMobileOverflow();
    container.addEventListener("scroll", updateMobileOverflow, { passive: true });
    window.addEventListener("resize", updateMobileOverflow);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", updateMobileOverflow);
      window.removeEventListener("resize", updateMobileOverflow);
    };
  }, [updateMobileOverflow]);

  return (
    <>
      <div className="hidden md:block">
        <div className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          <div
            aria-label="학생 대시보드 섹션"
            className="flex min-w-max items-center gap-1 border-b border-gray-200 bg-white/80 px-1"
            role="tablist"
          >
            {sectionTabs.map(section => {
              const isSelected = activeSection === section.id;

              return (
                <button
                  aria-controls={panelId}
                  aria-selected={isSelected}
                  className={cn(
                    "shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
                    isSelected
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                      : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800",
                  )}
                  id={`${tabIdPrefix}-${section.id}`}
                  key={section.id}
                  onClick={() => onChange(section.id)}
                  role="tab"
                  type="button"
                >
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative min-w-0 md:hidden">
        <div
          ref={mobileScrollRef}
          aria-label="학생 대시보드 섹션"
          className="overflow-x-auto [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          <div className="flex min-w-full items-center border-b border-gray-200 bg-white/80">
            {sectionTabs.map(section => {
              const isSelected = activeSection === section.id;
              const Icon = section.Icon;

              return (
                <button
                  aria-controls={panelId}
                  aria-label={section.label}
                  aria-selected={isSelected}
                  className={cn(
                    "relative flex min-w-14 flex-1 basis-0 items-center justify-center py-2.5 text-gray-400 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset",
                    isSelected ? "text-emerald-600" : "hover:text-gray-700",
                  )}
                  id={`${tabIdPrefix}-${section.id}`}
                  key={section.id}
                  onClick={() => onChange(section.id)}
                  role="tab"
                  type="button"
                >
                  {Icon ? (
                    <Icon aria-hidden size={20} />
                  ) : (
                    <span aria-hidden="true" className="text-sm font-bold tracking-tight">{section.mobileLabel}</span>
                  )}
                  <span className="sr-only">{section.label}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute bottom-0 h-0.5 w-6 rounded-full bg-emerald-600 transition-opacity duration-200",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {canScrollLeft && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white via-white/85 to-transparent" />
        )}
        {canScrollRight && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white via-white/85 to-transparent" />
        )}
      </div>
    </>
  );
}
