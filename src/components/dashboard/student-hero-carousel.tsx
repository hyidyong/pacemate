"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const loadedSlideIndexes = new Set([
    currentIndex,
    (currentIndex + 1) % HERO_SLIDES.length,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentIndex((currentIndex) => (currentIndex + 1) % HERO_SLIDES.length);
    }, 2_500);

    return () => window.clearInterval(intervalId);
  }, [currentIndex]);

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
          className="absolute left-2 top-1/2 z-10 pointer-events-auto inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/80 text-emerald-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:left-3 md:h-10 md:w-10"
          onClick={goToPrevious}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={22} />
        </button>

        <button
          aria-label="다음 슬라이드"
          className="absolute right-2 top-1/2 z-10 pointer-events-auto inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/80 text-emerald-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:right-3 md:h-10 md:w-10"
          onClick={goToNext}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={22} />
        </button>

        <div className="absolute bottom-2 left-1/2 z-10 pointer-events-auto flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/80 px-2.5 py-1.5 shadow-sm md:bottom-3">
          {HERO_SLIDES.map((slide, index) => (
            <button
              aria-current={index === currentIndex ? "true" : undefined}
              aria-label={`${index + 1}번 슬라이드로 이동`}
              className={`h-2.5 w-2.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
                index === currentIndex ? "bg-emerald-600" : "bg-slate-300 hover:bg-emerald-300"
              }`}
              key={slide.src}
              onClick={() => setCurrentIndex(index)}
              type="button"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
