import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL(".", import.meta.url));
const migrationName = readdirSync(migrationsDirectory)
  .find((file) => /^\d+_add_student_timetable_slots\.sql$/.test(file));

assert.ok(
  migrationName,
  "expected a generated *_add_student_timetable_slots.sql migration",
);

const sql = readFileSync(join(migrationsDirectory, migrationName), "utf8");
const normalizedSql = sql.replace(/\s+/g, " ").toLowerCase();
const koreanWeekdayCheck = /day_of_week text not null check \(day_of_week in \(u&'\\c6d4', u&'\\d654', u&'\\c218', u&'\\baa9', u&'\\ae08', u&'\\d1a0', u&'\\c77c'\)\)/;
const koreanWeekdayList = /u&'\\c6d4', u&'\\d654', u&'\\c218', u&'\\baa9', u&'\\ae08', u&'\\d1a0', u&'\\c77c'/;

function sqlStatements() {
  return sql
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

function assertAuthenticatedOnlyGrant(tableName) {
  const grants = sqlStatements().filter(
    (statement) => /^grant\b/.test(statement) && statement.includes(`public.${tableName}`),
  );

  assert.ok(grants.length > 0, `expected an authenticated grant for ${tableName}`);
  for (const grant of grants) {
    const roles = grant.match(/\bto\s+(.+)$/)?.[1]
      .split(",")
      .map((role) => role.trim().replace(/^"|"$/g, ""));

    assert.deepEqual(roles, ["authenticated"], `${tableName} must not grant access to non-authenticated roles`);
  }
}

function tableDefinition(tableName) {
  const match = normalizedSql.match(
    new RegExp(`create table\\s+public\\.${tableName}\\s*\\((.*?)\\)\\s*;`),
  );

  assert.ok(match, `expected public.${tableName} table definition`);
  return match[1];
}

function assertOwnsThroughProfiles(tableName, parentTableName, parentForeignKey) {
  const policyPattern = new RegExp(
    `create policy [\"'][^\"']+[\"'] on public\\.${tableName} for all to authenticated using \\(exists \\( select 1 from public\\.${parentTableName} [a-z]+ join public\\.profiles p on p\\.id = [a-z]+\\.${parentForeignKey} where [a-z]+\\.id = ${tableName}\\.[a-z_]+ and p\\.auth_user_id = \\(select auth\\.uid\\(\\)\\) \\)\\) with check \\(exists`,
  );

  assert.match(normalizedSql, policyPattern);
}

test("creates normalized student-course timetable slots with constraints and legacy backfill", () => {
  const slots = tableDefinition("student_course_schedule_slots");

  assert.match(slots, /student_course_id uuid not null references public\.student_courses\(id\) on delete cascade/);
  assert.match(slots, koreanWeekdayCheck);
  assert.match(slots, /start_time time not null/);
  assert.match(slots, /end_time time not null/);
  assert.match(slots, /classroom text/);
  assert.match(slots, /source text not null default 'manual' check \(source in \('syllabus', 'professor', 'manual', 'legacy'\)\)/);
  assert.match(slots, /created_at timestamptz not null default now\(\)/);
  assert.match(slots, /updated_at timestamptz not null default now\(\)/);
  assert.match(slots, /constraint student_course_schedule_slots_time_order check \(start_time < end_time\)/);
  assert.match(slots, /unique \(student_course_id, day_of_week, start_time, end_time\)/);

  assert.match(normalizedSql, /create index if not exists student_course_schedule_slots_course_day_time_idx on public\.student_course_schedule_slots\s*\(student_course_id, day_of_week, start_time\)/);
  const legacyColumns = sqlStatements().find((statement) =>
    statement.includes("alter table public.student_courses"),
  );
  assert.ok(legacyColumns, "expected an additive legacy student_courses column declaration");
  assert.match(legacyColumns, /add column if not exists schedule_day text/);
  assert.match(legacyColumns, /add column if not exists start_time time/);
  assert.match(legacyColumns, /add column if not exists end_time time/);
  assert.match(legacyColumns, /add column if not exists classroom text/);
  assert.match(legacyColumns, /add column if not exists semester_label text default '2026-2'/);
  assert.match(legacyColumns, /add column if not exists is_favorite boolean(?: not null)? default false/);
  assert.match(legacyColumns, /add column if not exists updated_at timestamptz(?: not null)? default now\(\)/);
  assert.ok(
    sql.toLowerCase().indexOf("alter table public.student_courses")
      < sql.toLowerCase().indexOf("insert into public.student_course_schedule_slots"),
    "legacy student_courses columns must be declared before the backfill",
  );
  assert.match(normalizedSql, /insert into public\.student_course_schedule_slots \(student_course_id, day_of_week, start_time, end_time, classroom, source\) select sc\.id, sc\.schedule_day, sc\.start_time, sc\.end_time, sc\.classroom, 'legacy' from public\.student_courses sc where sc\.schedule_day in \(/);
  assert.match(normalizedSql, koreanWeekdayList);
  assert.match(normalizedSql, /and sc\.start_time is not null and sc\.end_time is not null and sc\.start_time < sc\.end_time on conflict \(student_course_id, day_of_week, start_time, end_time\) do nothing/);
});

test("creates student custom courses and normalized slots", () => {
  const courses = tableDefinition("student_custom_courses");
  const slots = tableDefinition("student_custom_course_schedule_slots");

  assert.match(courses, /student_id uuid not null references public\.profiles\(id\) on delete cascade/);
  assert.match(courses, /title text not null check \(btrim\(title\) <> ''\)/);
  assert.match(courses, /color text/);
  assert.match(courses, /created_at timestamptz not null default now\(\)/);
  assert.match(courses, /updated_at timestamptz not null default now\(\)/);
  assert.match(slots, /student_custom_course_id uuid not null references public\.student_custom_courses\(id\) on delete cascade/);
  assert.match(slots, koreanWeekdayCheck);
  assert.match(slots, /start_time time not null/);
  assert.match(slots, /end_time time not null/);
  assert.match(slots, /classroom text/);
  assert.match(slots, /constraint student_custom_course_schedule_slots_time_order check \(start_time < end_time\)/);
  assert.match(slots, /unique \(student_custom_course_id, day_of_week, start_time, end_time\)/);

  assert.match(normalizedSql, /create index if not exists student_custom_courses_student_updated_idx on public\.student_custom_courses\s*\(student_id, updated_at desc\)/);
  assert.match(normalizedSql, /create index if not exists student_custom_course_schedule_slots_course_day_time_idx on public\.student_custom_course_schedule_slots\s*\(student_custom_course_id, day_of_week, start_time\)/);
});

test("secures every new timetable table for authenticated owners only", () => {
  for (const tableName of [
    "student_course_schedule_slots",
    "student_custom_courses",
    "student_custom_course_schedule_slots",
  ]) {
    assert.match(normalizedSql, new RegExp(`alter table public\\.${tableName} enable row level security`));
    assertAuthenticatedOnlyGrant(tableName);
    assert.match(normalizedSql, new RegExp(`create trigger ${tableName}_set_updated_at before update on public\\.${tableName} for each row execute function public\\.set_updated_at\\(\\)`));
  }

  assert.match(normalizedSql, /create policy "students manage own custom courses" on public\.student_custom_courses for all to authenticated using \(exists \( select 1 from public\.profiles p where p\.id = student_custom_courses\.student_id and p\.auth_user_id = \(select auth\.uid\(\)\) \)\) with check \(exists/);
  assertOwnsThroughProfiles("student_course_schedule_slots", "student_courses", "student_id");
  assertOwnsThroughProfiles("student_custom_course_schedule_slots", "student_custom_courses", "student_id");
});
