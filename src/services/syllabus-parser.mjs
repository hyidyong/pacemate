const DAY_NAMES = "\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0\uC77C";
const FIELD_LABELS = {
  name: ["\uAD50\uACFC\uBAA9\uBA85", "\uACFC\uBAA9\uBA85", "course name"],
  code: ["\uAD50\uACFC\uBAA9\uCF54\uB4DC", "\uACFC\uBAA9\uCF54\uB4DC", "course code"],
  professorName: ["\uB2F4\uB2F9\uAD50\uC218", "\uAD50\uC218\uBA85", "professor"],
  credits: ["\uD559\uC810", "credits"],
};

function fieldValue(text, labels) {
  const label = labels.join("|");
  const match = text.match(new RegExp("(?:"
    + label
    + ")\\s*[:：]\\s*([^\\n\\r]+)", "i"));
  return match?.[1]?.trim() || null;
}

function compactFieldValue(text, startLabel, endLabel) {
  const match = text.match(new RegExp(startLabel + "(.+?)" + endLabel));
  return match?.[1]?.trim() || null;
}

function parseNumber(value) {
  const number = Number(value?.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : null;
}

function parseSchedules(text) {
  const schedules = [];
  const pattern = new RegExp("([" + DAY_NAMES + "])\\s*(\\d{1,2}:\\d{2})\\s*[-~至]\\s*(\\d{1,2}:\\d{2})", "g");
  for (const match of text.matchAll(pattern)) {
    const [, dayOfWeek, startTime, endTime] = match;
    schedules.push({ dayOfWeek, startTime, endTime, classroom: null });
  }
  return schedules;
}

function parseAssessments(text) {
  const ratioSection = text.match(/\uBC18\uC601\uBE44\uC728[\s\S]{0,100}?((?:\d{2}(?:\.\d{2})?){4})/);
  if (ratioSection) {
    const weights = ratioSection[1].match(/\d{2}(?:\.\d{2})?/g)?.slice(0, 4).map(Number) ?? [];
    const types = [
      ["attendance", "\uCD9C\uC11D"],
      ["final", "\uAE30\uB9D0\uACE0\uC0AC"],
      ["midterm", "\uC911\uAC04\uACE0\uC0AC"],
      ["assignment", "\uACFC\uC81C"],
    ];
    return types.map(([type, title], index) => ({
      type,
      title,
      weightPercent: weights[index] ?? null,
      description: null,
    }));
  }

  const definitions = [
    ["attendance", /(\uCD9C\uC11D|attendance)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i, "\uCD9C\uC11D"],
    ["midterm", /(\uC911\uAC04\uACE0\uC0AC|midterm)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i, "\uC911\uAC04\uACE0\uC0AC"],
    ["final", /(\uAE30\uB9D0\uACE0\uC0AC|final)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i, "\uAE30\uB9D0\uACE0\uC0AC"],
    ["assignment", /(\uACFC\uC81C|assignment)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i, "\uACFC\uC81C"],
    ["quiz", /(\uD034\uC988|quiz)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i, "\uD034\uC988"],
    ["presentation", /(\uBC1C\uD45C|presentation)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i, "\uBC1C\uD45C"],
  ];
  return definitions.flatMap(([type, pattern, title]) => {
    const match = text.match(pattern);
    return match ? [{ type, title, weightPercent: Number(match[2]), description: null }] : [];
  });
}

function parseWeeks(text) {
  const weeks = [];
  const lines = text.split(/\r?\n/).map((item) => item.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(?:[-•*]\s*)?(\d{1,2})\s*\uC8FC(?:\uCC28)?\s*[:：.)-]?\s*(.*)$/);
    if (!match) continue;
    const weekNumber = Number(match[1]);
    if (weekNumber < 1 || weekNumber > 15) continue;
    let title = match[2].trim();
    if (!title) {
      const nextLine = lines.slice(index + 1).find((line) => line && !/^\uAD50\uC721\uB0B4\uC6A9|^\uCCAB\uC9F8|^\uB458\uC9F8|^\uC14B\uC9F8|^\uB124\uC9F8/.test(line));
      title = nextLine ?? "";
    }
    const examType = /\uC911\uAC04\uACE0\uC0AC|midterm/i.test(title) ? "midterm" : /\uAE30\uB9D0\uACE0\uC0AC|final/i.test(title) ? "final" : null;
    weeks.push({ weekNumber, title: title || null, description: null, isExamWeek: Boolean(examType), examType, sourceText: lines[index] });
  }
  return [...new Map(weeks.map((week) => [week.weekNumber, week])).values()].sort((a, b) => a.weekNumber - b.weekNumber);
}

export function parseSyllabusText(rawText) {
  const text = rawText.replace(/\u0000/g, "").trim();
  const warnings = [];
  const courseName = fieldValue(text, FIELD_LABELS.name) ?? compactFieldValue(text, "\uAD50\uACFC\uBAA9\uBA85", "\uAD50\uACFC\uBAA9\uCF54\uB4DC");
  const courseCode = fieldValue(text, FIELD_LABELS.code) ?? text.match(/\uAD50\uACFC\uBAA9\uCF54\uB4DC([A-Za-z0-9-]+)/)?.[1] ?? null;
  const professorName = fieldValue(text, FIELD_LABELS.professorName) ?? compactFieldValue(text, "\uB2F4\uB2F9\uAD50\uC218", "\uAC15\uC758\uC2DC\uAC04");
  const credits = parseNumber(fieldValue(text, FIELD_LABELS.credits) ?? text.match(/\uD559\uC810(\d+)/)?.[1]);
  const schedules = parseSchedules(text);
  const assessments = parseAssessments(text);
  const weeks = parseWeeks(text);

  if (!courseName) warnings.push("course name missing");
  if (!courseCode) warnings.push("course code missing");
  if (schedules.length === 0) warnings.push("class schedule missing");
  if (weeks.length === 0) warnings.push("weekly plan for weeks 1-15 missing");

  return {
    academicYear: parseNumber(text.match(/(20\d{2})\s*(?:\uD559\uB144\uB3C4|\uB144)/)?.[0]),
    semester: parseNumber(text.match(/(\d)\s*\uD559\uAE30/)?.[0]),
    course: {
      name: courseName,
      code: courseCode,
      university: null,
      department: null,
      classification: null,
      credits,
      professorName,
      classroom: null,
      targetGrade: null,
      description: null,
      objectives: null,
      prerequisites: null,
      usage: null,
    },
    schedules,
    assessments,
    weeks,
    warnings,
  };
}
