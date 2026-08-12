import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("./student-hero-carousel.tsx", import.meta.url);
const dashboardPath = new URL("../../app/dashboard/page.tsx", import.meta.url);
const appShellPath = new URL("../layout/app-shell.tsx", import.meta.url);

test("student hero carousel keeps banner images uncropped and supports every navigation path", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /^"use client";/);
  assert.match(source, /useState\(0\)/);
  // Stage 4 (audit D-14/C-18, deliberate change): the 2.5s always-on interval
  // violated WCAG 2.2.2 — the carousel must pause via button, hover/focus,
  // and prefers-reduced-motion, at a calmer 5s cadence.
  assert.match(source, /5_000/);
  assert.doesNotMatch(source, /2_500/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /aria-pressed=\{isPaused\}/);
  assert.match(source, /clearInterval/);
  assert.match(source, /currentIndex - 1 \+ HERO_SLIDES\.length/);
  assert.match(source, /currentIndex \+ 1/);
  assert.match(source, /setCurrentIndex\(index\)/);
  assert.match(source, /translateX\(`?-?\$\{currentIndex \* 100\}%`?\)/);
  assert.match(source, /className="mt-4 md:mt-6"/);
  assert.match(source, /className="w-full flex-none"/);
  assert.match(source, /className="block h-auto w-full object-contain"/);
  assert.doesNotMatch(source, /min-w-full|object-cover|min-h-\[|100vh|background-size/);
  assert.match(source, /z-10[^"\n]*pointer-events-auto/);
  assert.match(source, /aria-label="이전 슬라이드"/);
  assert.match(source, /aria-label="다음 슬라이드"/);
  assert.match(source, /aria-label=\{`\$\{index \+ 1\}번 슬라이드로 이동`\}/);
});

test("student hero carousel uses local static banners that are easy to replace", async () => {
  const source = await readFile(componentPath, "utf8");
  const urls = [
    "/images/hero-1.jpg",
    "/images/hero-2.jpg",
    "/images/hero-3.jpg",
    "/images/hero-4.jpg",
  ];

  for (const url of urls) assert.match(source, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // The slow external image host must stay gone (KI-008).
  assert.doesNotMatch(source, /i\.ibb\.co/);
});

test("student hero carousel only loads the active transition images", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /const loadedSlideIndexes = new Set/);
  assert.match(source, /src=\{loadedSlideIndexes\.has\(index\) \? slide\.src : undefined\}/);
  assert.match(source, /fetchPriority=\{index === currentIndex \? "high" : "auto"\}/);
});

test("student dashboard renders the carousel above notifications only for students", async () => {
  const source = await readFile(dashboardPath, "utf8");
  const carouselIndex = source.indexOf("<StudentHeroCarousel />");
  const notificationIndex = source.indexOf("<NotificationStrip");

  assert.match(source, /import \{ StudentHeroCarousel \} from "@\/components\/dashboard\/student-hero-carousel";/);
  assert.ok(carouselIndex > -1, "carousel should be rendered");
  assert.ok(carouselIndex < notificationIndex, "carousel should appear above notifications");
  assert.match(source, /profile\.role === "student"[\s\S]*?<StudentHeroCarousel \/>/);
});

test("student dashboard shares shell data and batches independent reads", async () => {
  const [dashboardSource, appShellSource] = await Promise.all([
    readFile(dashboardPath, "utf8"),
    readFile(appShellPath, "utf8"),
  ]);

  assert.match(appShellSource, /profile\?: DemoProfile \| null/);
  assert.match(appShellSource, /notifications\?: UserNotification\[\]/);
  assert.match(appShellSource, /unreadCount\?: number/);
  assert.match(dashboardSource, /<AppShell[\s\S]*profile=\{profile\}/);
  assert.match(dashboardSource, /notifications=\{notifications\}/);
  assert.match(dashboardSource, /unreadCount=\{unreadCount\}/);
  assert.match(dashboardSource, /const \[myCoursesResult, announcementsResult, studentCourseResult, counselingResult\] = await Promise\.all/);
  assert.match(dashboardSource, /\.in\("course_id", courseIds\)/);
  assert.doesNotMatch(dashboardSource, /for \(const sc of studentCourseData\)[\s\S]*?await supabase/);
});
