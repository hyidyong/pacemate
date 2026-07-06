import { useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProfessorTeachingSlot, ProfessorCounselingRequest, ProfessorAdminTaskRecord, ProfessorAvailability } from "@/services/professor.service";
import { calculateRecommendedAvailability } from "@/lib/calendar-utils";
import { useRouter } from "next/navigation";

type ProfessorCalendarProps = {
  teachingSlots: ProfessorTeachingSlot[];
  counselingRequests: ProfessorCounselingRequest[];
  adminTasks: ProfessorAdminTaskRecord[];
  availability: ProfessorAvailability[];
  onToggleBlackout?: (slot: any) => void;
};

export function ProfessorCalendar({
  teachingSlots,
  counselingRequests,
  adminTasks,
  availability,
  onToggleBlackout,
}: ProfessorCalendarProps) {
  const router = useRouter();
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  const days = ["월", "화", "수", "목", "금"];
  const startHour = 9;
  const endHour = 18;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  // Generate week dates based on currentDate
  const weekDates = useMemo(() => {
    const dayOfWeek = currentDate.getDay(); // 0 is Sunday, 1 is Monday
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + diffToMonday);

    return days.map((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        label: day,
        date: d.getDate(),
        fullDate: d,
        dayIndex: i + 1, // 1 to 5
      };
    });
  }, [currentDate]);

  function prevWeek() {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  }

  function nextWeek() {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  }

  // Combine and format blocks
  const blocks = useMemo(() => {
    const list: any[] = [];
    
    // 1. Course Schedule (Light Blue)
    teachingSlots.forEach((slot) => {
      if (slot.day_of_week >= 1 && slot.day_of_week <= 5) {
        list.push({
          id: `course-${slot.id}`,
          type: "course",
          title: slot.course?.name || "강의",
          courseId: slot.course?.id,
          day: slot.day_of_week,
          startTime: slot.start_time.slice(0, 5),
          endTime: slot.end_time.slice(0, 5),
          color: "var(--color-tone-normal-bg, #e3f2fd)",
          textColor: "var(--color-tone-normal-fg, #1565c0)",
          details: `${slot.classroom || "강의실 미정"}`,
        });
      }
    });

    // 2. Admin Tasks (Light Purple) & Specific Date Blackouts
    adminTasks.forEach((task) => {
      if (task.day_of_week >= 1 && task.day_of_week <= 5) {
        if (task.title.startsWith("__BLACKOUT__")) {
          const blackoutDate = task.title.split("__")[2];
          // Only show on the matching specific date
          const targetDayDateObj = weekDates[task.day_of_week - 1]?.fullDate;
          if (targetDayDateObj && targetDayDateObj.toISOString().split('T')[0] === blackoutDate) {
            list.push({
              id: `admin-blackout-${task.id}`,
              type: "recommended", // use recommended type to allow toggle
              title: "상담 불가 (특정일 차단)",
              day: task.day_of_week,
              startTime: task.start_time.slice(0, 5),
              endTime: task.end_time.slice(0, 5),
              color: "#eeeeee",
              textColor: "#757575",
              details: "특정 날짜 수동 차단",
              isBlackout: true,
              rawSlot: { type: "admin_blackout", id: task.id },
            });
          }
        } else {
          list.push({
            id: `admin-${task.id}`,
            type: "admin",
            title: task.title,
            day: task.day_of_week,
            startTime: task.start_time.slice(0, 5),
            endTime: task.end_time.slice(0, 5),
            color: "#f3e5f5", // Light Purple
            textColor: "#6a1b9a",
            details: "행정 업무",
          });
        }
      }
    });

    // 3. Counseling (Light Green)
    counselingRequests
      .filter((req) => req.status === "approved")
      .forEach((req) => {
        const startDate = new Date(req.suggested_start || req.requested_start);
        const endDate = new Date(req.suggested_end || req.requested_end);
        const day = startDate.getDay();
        if (day >= 1 && day <= 5) {
          const startTime = `${startDate.getHours().toString().padStart(2, "0")}:${startDate.getMinutes().toString().padStart(2, "0")}`;
          const endTime = `${endDate.getHours().toString().padStart(2, "0")}:${endDate.getMinutes().toString().padStart(2, "0")}`;
          list.push({
            id: `counsel-${req.id}`,
            type: "counseling",
            title: req.topic,
            day: day,
            startTime,
            endTime,
            color: "var(--color-tone-calm-bg, #e8f5e9)",
            textColor: "var(--color-tone-calm-fg, #2e7d32)",
            details: "학생 상담",
          });
        }
      });

    // 4. Recommended Available Times (Light Green dashed or slightly darker)
    const recommended = calculateRecommendedAvailability(
      teachingSlots,
      adminTasks,
      counselingRequests,
      availability,
      weekDates
    );
    
    recommended.forEach((rec) => {
      list.push({
        id: `rec-${rec.day}-${rec.start}`,
        type: "recommended",
        title: rec.isBlackout ? "상담 불가 (개인)" : "상담 가능 (추천)",
        day: rec.day,
        startTime: rec.start,
        endTime: rec.end,
        color: rec.isBlackout ? "#eeeeee" : "var(--color-tone-setup-bg, #f0fdf4)",
        textColor: rec.isBlackout ? "#757575" : "var(--color-tone-setup-fg, #166534)",
        details: rec.isBlackout ? "교수가 수동으로 상담을 차단한 시간입니다." : "상담 예약이 가능한 시간입니다.",
        isBlackout: rec.isBlackout,
        rawSlot: rec,
      });
    });

    return list;
  }, [teachingSlots, adminTasks, counselingRequests, availability, weekDates]);

  function getGridRow(time: string) {
    const [h, m] = time.split(":").map(Number);
    const totalMinutes = (h - startHour) * 60 + m;
    return Math.floor(totalMinutes / 15) + 2;
  }

  function handleEmptySlotClick(dayIndex: number, hourIndex: number) {
    if (onToggleBlackout) {
      const startHourStr = (startHour + hourIndex).toString().padStart(2, '0');
      const endHourStr = (startHour + hourIndex + 1).toString().padStart(2, '0');
      const clickedDate = weekDates[dayIndex].fullDate;
      const specificDateStr = clickedDate.toISOString().split('T')[0];
      
      // Create a dummy slot to block
      const dummySlot = {
        day: dayIndex + 1, // 1 to 5
        specificDate: specificDateStr,
        start: `${startHourStr}:00`,
        end: `${endHourStr}:00`,
        isBlackout: false, // it will toggle to true
      };
      onToggleBlackout(dummySlot);
    }
  }

  return (
    <div className="professor-calendar-container" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Navigation & Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--color-bg)", padding: "4px", borderRadius: "8px", border: "1px solid var(--color-border)" }}>
            <button className="button button-icon" onClick={prevWeek} style={{ border: "none", background: "transparent", padding: "4px" }}><ChevronLeft size={18} /></button>
            <span style={{ fontWeight: "bold", fontSize: "16px" }}>{currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월</span>
            <button className="button button-icon" onClick={nextWeek} style={{ border: "none", background: "transparent", padding: "4px" }}><ChevronRight size={18} /></button>
          </div>
          
          <div style={{ display: "flex", gap: "12px", fontSize: "12px", fontWeight: "500", color: "var(--color-text-muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e3f2fd" }}></span> 강의
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f3e5f5" }}></span> 행정
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e8f5e9" }}></span> 상담
            </span>
          </div>
        </div>

        <button 
          className="button button-default button-sm" 
          onClick={() => {
            alert("데모 시간표 데이터가 로드되었습니다.");
            // In a real app, this would fetch data and refresh.
          }}
        >
          샘플 시간표 불러오기
        </button>
      </div>

      {/* CSS Grid Calendar */}
      <div 
        className="timeblocks-calendar"
        style={{
          display: "grid",
          gridTemplateColumns: "50px repeat(5, 1fr)",
          gridTemplateRows: `40px repeat(${(endHour - startHour) * 4}, 15px)`,
          gap: "1px",
          background: "var(--color-border)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {/* Top-Left Empty Header */}
        <div style={{ background: "var(--color-bg)", gridRow: 1, gridColumn: 1 }}></div>

        {/* Day Headers */}
        {weekDates.map((wd, index) => (
          <div key={wd.label} style={{ background: "var(--color-bg)", gridRow: 1, gridColumn: index + 2, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", fontWeight: "600", fontSize: "14px", padding: "4px" }}>
            <span>{wd.label}</span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: "normal" }}>{wd.date}</span>
          </div>
        ))}

        {/* Time Labels */}
        {hours.map((hour, index) => (
          <div 
            key={`time-${hour}`} 
            style={{ 
              background: "var(--color-bg)", 
              gridRow: `${index * 4 + 2} / span 4`, 
              gridColumn: 1, 
              display: "flex", 
              justifyContent: "center", 
              paddingTop: "8px", 
              fontSize: "12px", 
              color: "var(--color-text-muted)" 
            }}
          >
            {hour}:00
          </div>
        ))}

        {/* Grid Cells (Empty Background) */}
        {weekDates.map((_, dayIndex) => (
          hours.map((_, hourIndex) => (
            <div 
              key={`cell-${dayIndex}-${hourIndex}`}
              onClick={() => handleEmptySlotClick(dayIndex, hourIndex)}
              style={{ 
                background: "var(--color-bg)", 
                gridRow: `${hourIndex * 4 + 2} / span 4`, 
                gridColumn: dayIndex + 2,
                borderBottom: "1px solid var(--color-border-subtle)",
                cursor: "pointer",
              }}
              title="클릭하여 일정 차단"
            ></div>
          ))
        ))}

        {/* Time Blocks */}
        {blocks.map((block) => {
          const rowStart = getGridRow(block.startTime);
          const rowEnd = getGridRow(block.endTime);
          const isRecommended = block.type === "recommended";
          
          return (
            <button
              key={block.id}
              onClick={(e) => {
                if (isRecommended && onToggleBlackout) {
                  // Toggle blackout immediately
                  e.stopPropagation();
                  onToggleBlackout(block.rawSlot);
                } else {
                  setSelectedBlock(block);
                }
              }}
              style={{
                gridRow: `${rowStart} / ${rowEnd}`,
                gridColumn: block.day + 1,
                background: block.color,
                color: block.textColor,
                margin: "1px",
                borderRadius: "4px",
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                fontSize: "11px",
                lineHeight: 1.2,
                border: isRecommended ? "1px dashed currentColor" : "none",
                cursor: "pointer",
                textAlign: "left",
                position: "relative",
                overflow: "hidden",
                zIndex: isRecommended ? 5 : 10,
                textDecoration: block.isBlackout ? "line-through" : "none",
              }}
              className="timeblock-card"
            >
              <strong style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", textOverflow: "ellipsis" }}>
                {block.title}
              </strong>
              <span style={{ opacity: 0.8, marginTop: "auto" }}>({block.startTime})</span>
              
              {/* Blur effect at the bottom for overflow */}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "12px", background: `linear-gradient(transparent, ${block.color})` }}></div>
            </button>
          );
        })}
      </div>

      {selectedBlock && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)", zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center" }} onClick={() => setSelectedBlock(null)}>
          <div style={{ background: "#ffffff", padding: "24px", borderRadius: "12px", maxWidth: "400px", width: "100%", boxShadow: "0 10px 25px rgba(0,0,0,0.15)", border: "1px solid #eaeaea" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "18px", color: "#333" }}>{selectedBlock.title}</h3>
            <p style={{ margin: "4px 0", color: "#666", fontSize: "14px" }}>
              {selectedBlock.day ? days[selectedBlock.day - 1] + "요일" : ""} {selectedBlock.startTime} ~ {selectedBlock.endTime}
            </p>
            <div style={{ marginTop: "16px", padding: "12px", background: "#f8f9fa", borderRadius: "8px", fontSize: "14px" }}>
              <p style={{ margin: "0 0 8px 0" }}><strong>상세:</strong> {selectedBlock.details}</p>
              <p style={{ margin: 0 }}><strong>구분:</strong> {selectedBlock.type === "course" ? "강의" : selectedBlock.type === "admin" ? "행정 업무" : "상담"}</p>
            </div>
            <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              {selectedBlock.type === "course" && selectedBlock.courseId && (
                <button 
                  className="button button-default button-sm" 
                  onClick={() => router.push(`/roadmap/${selectedBlock.courseId}`)}
                  style={{ background: "#f0f0f0", color: "#333", border: "1px solid #ddd" }}
                >
                  과목 상세 이동
                </button>
              )}
              <button 
                className="button button-default button-sm" 
                onClick={() => setSelectedBlock(null)}
                style={{ background: "#333", color: "#fff" }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
