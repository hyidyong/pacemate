"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

const HERO_SLIDES = [
  {
    src: "/images/hero-1.jpg",
    alt: "Sub-Study 학생 대시보드 안내 배너 1",
  },
  {
    src: "/images/hero-2.jpg",
    alt: "Sub-Study 학생 대시보드 안내 배너 2",
  },
  {
    src: "/images/hero-3.jpg",
    alt: "Sub-Study 학생 대시보드 안내 배너 3",
  },
  {
    src: "/images/hero-4.jpg",
    alt: "Sub-Study 학생 대시보드 안내 배너 4",
  },
] as const;

export function StudentHeroCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const loadedSlideIndexes = new Set([
    currentIndex,
    (currentIndex + 1) % HERO_SLIDES.length,
  ]);

  // WCAG 2.2.2: auto-advance must be pausable — via the pause button, on
  // hover/focus, and automatically under prefers-reduced-motion (audit
  // D-14/C-18). The old 2.5s interval also made the 10px dots moving targets.
  useEffect(() => {
    if (isPaused || isHovered) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setCurrentIndex((currentIndex) => (currentIndex + 1) % HERO_SLIDES.length);
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [currentIndex, isHovered, isPaused]);

  const goToPrevious = () => {
    setCurrentIndex(
      (currentIndex) => (currentIndex - 1 + HERO_SLIDES.length) % HERO_SLIDES.length,
    );
  };

  const goToNext = () => {
    setCurrentIndex((currentIndex) => (currentIndex + 1) % HERO_SLIDES.length);
  };

  return (
    <section
      aria-label="학생 대시보드 주요 안내"
      aria-roledescription="carousel"
      className="mt-4 md:mt-6"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsHovered(false);
        }
      }}
      onFocus={() => setIsHovered(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5">
        <div
          className="flex transition-transform duration-700 ease-out will-change-transform"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {HERO_SLIDES.map((slide, index) => (
            <div
              aria-hidden={index !== currentIndex}
              className="w-full flex-none"
              key={slide.src}
            >
              <img
                alt={slide.alt}
                className="block h-auto w-full object-contain"
                draggable={false}
                fetchPriority={index === currentIndex ? "high" : "auto"}
                src={loadedSlideIndexes.has(index) ? slide.src : undefined}
              />
            </div>
          ))}
        </div>

        <button
          aria-label="이전 슬라이드"
          className="absolute left-2 top-1/2 z-10 pointer-events-auto inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/80 text-emerald-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:left-3 md:h-11 md:w-11"
          onClick={goToPrevious}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={22} />
        </button>

        <button
          aria-label="다음 슬라이드"
          className="absolute right-2 top-1/2 z-10 pointer-events-auto inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/80 text-emerald-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:right-3 md:h-11 md:w-11"
          onClick={goToNext}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={22} />
        </button>

        <div className="absolute bottom-2 left-1/2 z-10 pointer-events-auto flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/80 px-1.5 py-0.5 shadow-sm md:bottom-3">
          <button
            aria-label={isPaused ? "슬라이드 자동 전환 재생" : "슬라이드 자동 전환 일시정지"}
            aria-pressed={isPaused}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            onClick={() => setIsPaused((current) => !current)}
            type="button"
          >
            {isPaused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
          </button>
          {HERO_SLIDES.map((slide, index) => (
            <button
              aria-current={index === currentIndex ? "true" : undefined}
              aria-label={`${index + 1}번 슬라이드로 이동`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              key={slide.src}
              onClick={() => setCurrentIndex(index)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                  index === currentIndex ? "bg-emerald-600" : "bg-slate-300 hover:bg-emerald-300"
                }`}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
