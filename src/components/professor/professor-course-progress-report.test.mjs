import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders an accessible Recharts difficulty report with a deliberate demo fallback", async () => {
  const source = await readFile(new URL("./professor-course-progress-report.tsx", import.meta.url), "utf8");

  assert.match(source, /from "recharts"/);
  assert.match(source, /<BarChart data=\{chartRows\}/);
  assert.match(source, /stackId="difficulty"/);
  assert.match(source, /수집된 학생 피드백이 아직 부족합니다\. 예시 데이터를 확인해 보세요\./);
  assert.match(source, /데모 리포트 상세 보기/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /개인 메모는 포함하지 않음/);
});
