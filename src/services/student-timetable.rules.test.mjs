import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

async function loadRules() {
  const source = await readFile(
    new URL("./student-timetable.rules.ts", import.meta.url),
    "utf8",
  );
  const compiled = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2022,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("prefers syllabus slots over professor and manual slots", async () => {
  const { resolveScheduleSource } = await loadRules();

  const result = resolveScheduleSource(
    [{ dayOfWeek: "목", startTime: "09:00", endTime: "10:15" }],
    [{ dayOfWeek: 1, startTime: "13:00", endTime: "14:15" }],
    [{ dayOfWeek: "금", startTime: "15:00", endTime: "16:15" }],
  );

  assert.equal(result.source, "syllabus");
  assert.deepEqual(result.slots, [
    { dayOfWeek: "목", startTime: "09:00", endTime: "10:15", classroom: null },
  ]);
});

test("falls back from professor slots to manual slots", async () => {
  const { resolveScheduleSource } = await loadRules();

  assert.deepEqual(
    resolveScheduleSource(
      [],
      [{ dayOfWeek: 1, startTime: "13:00", endTime: "14:15" }],
      [{ dayOfWeek: "금", startTime: "15:00", endTime: "16:15" }],
    ),
    {
      source: "professor",
      slots: [{ dayOfWeek: "월", startTime: "13:00", endTime: "14:15", classroom: null }],
    },
  );

  assert.equal(
    resolveScheduleSource(
      [],
      [],
      [{ dayOfWeek: "금", startTime: "15:00", endTime: "16:15" }],
    ).source,
    "manual",
  );
});

test("converts numeric weekdays and rejects unsupported weekday values", async () => {
  const { toKoreanWeekday } = await loadRules();

  assert.equal(toKoreanWeekday(0), "일");
  assert.equal(toKoreanWeekday(6), "토");
  assert.equal(toKoreanWeekday(" 화 "), "화");
  assert.equal(toKoreanWeekday(-1), null);
  assert.equal(toKoreanWeekday(7), null);
  assert.equal(toKoreanWeekday("월요일"), null);
});

test("rejects invalid slots and deduplicates canonical day and time values", async () => {
  const { validateScheduleSlots } = await loadRules();

  assert.deepEqual(
    validateScheduleSlots([
      { dayOfWeek: "휴", startTime: "09:00", endTime: "10:15" },
      { dayOfWeek: "월", startTime: "10:15", endTime: "10:15" },
      { dayOfWeek: "화", startTime: "11:00", endTime: "10:15" },
      { dayOfWeek: 1, startTime: "09:00", endTime: "10:15", classroom: "  공학관  " },
      { dayOfWeek: "월", startTime: "09:00", endTime: "10:15", classroom: "다른 강의실" },
    ]),
    [{ dayOfWeek: "월", startTime: "09:00", endTime: "10:15", classroom: "공학관" }],
  );
});
