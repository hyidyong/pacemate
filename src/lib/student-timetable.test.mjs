import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

async function loadTimetable() {
  const source = await readFile(new URL("./student-timetable.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source.replace(/import \{[^\n]+\} from "react";\r?\n/, ""), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const regularCourse = {
  id: "enrollment-1", status: "interested", is_favorite: true,
  schedule_day: "월", start_time: "09:00", end_time: "10:15", classroom: "A101", semester_label: "2026-2",
  course: { id: "course-1", school_id: null, code: "CS101", name: "Algorithms", credit: 3, category: null, description: null, prerequisite_text: null },
};

test("flattens every normalized regular and custom course slot into timetable items", async () => {
  const { toTimetableDisplayItems } = await loadTimetable();
  const items = toTimetableDisplayItems([
    { ...regularCourse, schedule_slots: [
      { id: "monday", day_of_week: "월", start_time: "09:00:00", end_time: "10:15:00", classroom: "A101" },
      { id: "wednesday", day_of_week: "수", start_time: "09:00:00", end_time: "10:15:00", classroom: "A101" },
    ] },
    { ...regularCourse, id: "custom:1", is_custom: true, timetable_color: "#dbeafe", course: { ...regularCourse.course, id: "custom:1", name: "Study group" }, schedule_slots: [
      { id: "friday", day_of_week: "금", start_time: "14:00:00", end_time: "15:00:00", classroom: null },
    ] },
  ]);

  assert.deepEqual(items.map((item) => [item.kind, item.schedule_day, item.start_time, item.end_time]), [
    ["course", "월", "09:00", "10:15"],
    ["course", "수", "09:00", "10:15"],
    ["custom", "금", "14:00", "15:00"],
  ]);
});

test("uses the legacy single slot only when normalized slots are absent", async () => {
  const { toTimetableDisplayItems } = await loadTimetable();
  assert.equal(toTimetableDisplayItems([regularCourse]).length, 1);
  assert.equal(toTimetableDisplayItems([{ ...regularCourse, schedule_slots: [] }])[0].id, "enrollment-1:legacy");
});
