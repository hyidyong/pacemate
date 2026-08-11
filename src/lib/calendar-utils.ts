import type {
  ProfessorTeachingSlot,
  ProfessorCounselingRequest,
  ProfessorAdminTaskRecord,
  ProfessorAvailability,
} from "@/services/professor.service";

// Define a time range type
export type TimeRange = {
  start: string;
  end: string;
};

// Convert HH:MM to minutes
function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Convert minutes to HH:MM
function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function calculateRecommendedAvailability(
  teachingSlots: ProfessorTeachingSlot[],
  adminTasks: ProfessorAdminTaskRecord[],
  counselingRequests: ProfessorCounselingRequest[],
  existingAvailability: ProfessorAvailability[],
  weekDates: { label: string; date: number; fullDate: Date; dayIndex: number }[]
) {
  const days = [1, 2, 3, 4, 5]; // Mon to Fri
  const defaultStart = 9 * 60; // 09:00
  const defaultEnd = 18 * 60; // 18:00
  const recommendedSlots: { day: number; specificDate: string; start: string; end: string; isBlackout: boolean; id?: string; rawSlot?: any }[] = [];

  days.forEach((day, index) => {
    // Collect all busy ranges for this day
    const busyRanges: { start: number; end: number }[] = [];
    const specificDateObj = weekDates[index]?.fullDate;
    const specificDateStr = specificDateObj 
      ? `${specificDateObj.getFullYear()}-${String(specificDateObj.getMonth() + 1).padStart(2, '0')}-${String(specificDateObj.getDate()).padStart(2, '0')}` 
      : null;

    // 1. Courses
    teachingSlots.forEach((slot) => {
      if (slot.day_of_week === day) {
        busyRanges.push({
          start: timeToMinutes(slot.start_time.slice(0, 5)),
          end: timeToMinutes(slot.end_time.slice(0, 5)),
        });
      }
    });

    // 2. Admin Tasks (including specific date blackouts)
    adminTasks.forEach((task) => {
      let isMatch = false;
      if (task.title.startsWith("__BLACKOUT__")) {
         const blackoutDate = task.title.split("__")[2];
         if (specificDateStr === blackoutDate) isMatch = true;
      } else {
         if (task.day_of_week === day) isMatch = true;
      }
      
      if (isMatch) {
        busyRanges.push({
          start: timeToMinutes(task.start_time.slice(0, 5)),
          end: timeToMinutes(task.end_time.slice(0, 5)),
        });
      }
    });

    // 3. Busy counseling requests — pending AND approved both block student
    // booking (DB exclusion constraint), so both must occupy the calendar.
    counselingRequests.forEach((req) => {
      if (req.status === "approved" || req.status === "pending") {
        const start = new Date(req.suggested_start || req.requested_start);
        const end = new Date(req.suggested_end || req.requested_end);
        const startLocalStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        
        if (start.getDay() === day && startLocalStr === specificDateStr) {
          busyRanges.push({
            start: start.getHours() * 60 + start.getMinutes(),
            end: end.getHours() * 60 + end.getMinutes(),
          });
        }
      }
    });

    // Merge busy ranges
    busyRanges.sort((a, b) => a.start - b.start);
    const mergedBusy: { start: number; end: number }[] = [];
    if (busyRanges.length > 0) {
      let current = busyRanges[0];
      for (let i = 1; i < busyRanges.length; i++) {
        if (busyRanges[i].start <= current.end) {
          current.end = Math.max(current.end, busyRanges[i].end);
        } else {
          mergedBusy.push(current);
          current = busyRanges[i];
        }
      }
      mergedBusy.push(current);
    }

    // Find free ranges
    let lastEnd = defaultStart;
    const freeRanges: { start: number; end: number }[] = [];
    
    mergedBusy.forEach((busy) => {
      if (busy.start > lastEnd) {
        freeRanges.push({ start: lastEnd, end: busy.start });
      }
      lastEnd = Math.max(lastEnd, busy.end);
    });

    if (lastEnd < defaultEnd) {
      freeRanges.push({ start: lastEnd, end: defaultEnd });
    }

    // Now for each free range, divide into 30-min chunks (or 60 min)
    // To match the blackout logic, we will check if existingAvailability marks it as inactive
    freeRanges.forEach((range) => {
      let currentChunkStart = range.start;
      while (currentChunkStart + 30 <= range.end) {
        const chunkEnd = currentChunkStart + 30;
        
        // Check if there's an existing availability record matching this chunk
        const startStr = minutesToTime(currentChunkStart);
        const endStr = minutesToTime(chunkEnd);
        
        const existingRecord = existingAvailability.find(
          (a) => a.day_of_week === day && a.start_time.startsWith(startStr)
        );

        // A blackout (is_active=false) row can span multiple chunks (the
        // calendar's own toggle writes 1-hour rows), so match by overlap —
        // the student engine blocks the entire covered range the same way.
        const overlappingBlackout = existingAvailability.find(
          (a) =>
            a.day_of_week === day &&
            !a.is_active &&
            currentChunkStart < timeToMinutes(a.end_time.slice(0, 5)) &&
            timeToMinutes(a.start_time.slice(0, 5)) < chunkEnd
        );

        // If no record exists, it is "recommended" (active by default)
        // If a record exists and is_active is false, it's a blackout.
        // If a record exists and is_active is true, it's explicitly active.
        const isBlackout = overlappingBlackout
          ? true
          : existingRecord
            ? !existingRecord.is_active
            : false;

        recommendedSlots.push({
          day,
          specificDate: specificDateStr as string,
          start: startStr,
          end: endStr,
          isBlackout,
          id: existingRecord?.id ?? overlappingBlackout?.id,
        });

        currentChunkStart += 30;
      }
    });
  });

  return recommendedSlots;
}
