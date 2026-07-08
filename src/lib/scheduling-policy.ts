export const STUDENT_BOOKING_END_HOUR = 18;

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function timeToMinutes(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function isWeekday(date: Date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function withHour(date: Date, hour: number) {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next;
}

export function isStudentBookableRange(start: Date, end: Date) {
  if (start >= end) {
    return false;
  }

  if (!isWeekday(start) || !isWeekday(end)) {
    return false;
  }

  const bookingEnd = withHour(start, STUDENT_BOOKING_END_HOUR);
  return end <= bookingEnd;
}

export function timeRangeEndsByStudentCutoff(startTime: string, endTime: string) {
  const endMinutes = timeToMinutes(endTime);
  return endMinutes <= timeToMinutes(`${STUDENT_BOOKING_END_HOUR}:00`);
}
