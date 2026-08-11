"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, Calendar as CalendarIcon, Clock, Ban, CalendarPlus, CheckCircle2 } from "lucide-react";
import type { ProfessorTeachingSlot, ProfessorCounselingRequest, ProfessorAdminTaskRecord, ProfessorAvailability } from "@/services/professor.service";
import { calculateRecommendedAvailability } from "@/lib/calendar-utils";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const WEEKDAYS = ["월", "화", "수", "목", "금"];

type ProfessorCalendarProps = {
  teachingSlots: ProfessorTeachingSlot[];
  counselingRequests: ProfessorCounselingRequest[];
  adminTasks: ProfessorAdminTaskRecord[];
  availability: ProfessorAvailability[];
  onToggleBlackout?: (slot: any) => void;
  onAddAdminTask?: (task: any) => void;
  onUpdateCounseling?: (requestId: string, note: string, location: string) => void;
  onCancelCounseling?: (requestId: string) => void;
};

export function ProfessorCalendar({
  teachingSlots,
  counselingRequests,
  adminTasks,
  availability,
  onToggleBlackout,
  onAddAdminTask,
  onUpdateCounseling,
  onCancelCounseling,
}: ProfessorCalendarProps) {
  const router = useRouter();
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [activeSlotAction, setActiveSlotAction] = useState<any>(null);
  const [customTaskTitle, setCustomTaskTitle] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());

  // Edit states for counseling
  const [counselingNote, setCounselingNote] = useState("");
  const [counselingLocation, setCounselingLocation] = useState("");

  const startHour = 9;
  const endHour = 18;


  // Generate week dates based on currentDate
  const weekDates = useMemo(() => {
    const dayOfWeek = currentDate.getDay(); // 0 is Sunday, 1 is Monday
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + diffToMonday);

    return WEEKDAYS.map((day, i) => {
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
          color: "bg-blue-50/80",
          textColor: "text-blue-950",
          borderColor: "border-transparent",
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
          if (targetDayDateObj) {
             const localDateStr = `${targetDayDateObj.getFullYear()}-${String(targetDayDateObj.getMonth() + 1).padStart(2, '0')}-${String(targetDayDateObj.getDate()).padStart(2, '0')}`;
             if (localDateStr === blackoutDate) {
               list.push({
                 id: `admin-blackout-${task.id}`,
                 type: "recommended", // use recommended type to allow toggle
                 title: "상담 불가 (특정일 차단)",
                 day: task.day_of_week,
                 startTime: task.start_time.slice(0, 5),
                 endTime: task.end_time.slice(0, 5),
                 color: "bg-gray-100",
                 textColor: "text-gray-500",
                 borderColor: "border-transparent",
                 details: "특정 날짜 수동 차단",
                 isBlackout: true,
                 rawSlot: { type: "admin_blackout", id: task.id },
               });
             }
          }
        } else {
          list.push({
            id: `admin-${task.id}`,
            type: "admin",
            title: task.title,
            day: task.day_of_week,
            startTime: task.start_time.slice(0, 5),
            endTime: task.end_time.slice(0, 5),
            color: "bg-purple-50",
            textColor: "text-purple-950",
            borderColor: "border-transparent",
            details: "행정 업무",
          });
        }
      }
    });

    // 3. Counseling (Confirmed)
    counselingRequests
      .filter((req) => req.status === "approved")
      .forEach((req) => {
        const startDate = new Date(req.suggested_start || req.requested_start);
        const endDate = new Date(req.suggested_end || req.requested_end);
        const day = startDate.getDay();
        if (day >= 1 && day <= 5) {
          const reqDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
          const targetDayDateObj = weekDates[day - 1]?.fullDate;
          if (targetDayDateObj) {
            const localDateStr = `${targetDayDateObj.getFullYear()}-${String(targetDayDateObj.getMonth() + 1).padStart(2, '0')}-${String(targetDayDateObj.getDate()).padStart(2, '0')}`;
            if (localDateStr === reqDateStr) {
              const startTime = `${startDate.getHours().toString().padStart(2, "0")}:${startDate.getMinutes().toString().padStart(2, "0")}`;
              const endTime = `${endDate.getHours().toString().padStart(2, "0")}:${endDate.getMinutes().toString().padStart(2, "0")}`;
              list.push({
                id: req.id, // Keep the raw request ID
                type: "counseling",
                title: req.student?.name ? `${req.student.name} 학생 상담` : "학생 상담",
                day: day,
                startTime,
                endTime,
                color: "bg-emerald-100/80 shadow-sm", // Distinct styling
                textColor: "text-emerald-950 font-semibold",
                borderColor: "border-transparent",
                details: req.topic,
                rawReq: req, // Store the raw request object for the modal
              });
            }
          }
        }
      });

    // 4. Recommended Available Times (Dashed Green)
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
        title: rec.isBlackout ? "상담 불가" : "상담 가능",
        day: rec.day,
        startTime: rec.start,
        endTime: rec.end,
        color: rec.isBlackout ? "bg-gray-100" : "bg-emerald-50/40 hover:bg-emerald-50/80 transition-colors",
        textColor: rec.isBlackout ? "text-gray-500" : "text-emerald-900/70",
        borderColor: rec.isBlackout ? "border-transparent" : "border-transparent",
        details: rec.isBlackout ? "교수가 수동으로 상담을 차단한 시간입니다." : "상담 예약이 가능한 시간입니다.",
        isBlackout: rec.isBlackout,
        rawSlot: rec,
      });
    });

    return list;
  }, [teachingSlots, adminTasks, counselingRequests, availability, weekDates]);

  const dynamicEndHour = useMemo(() => {
    let max = endHour;
    blocks.forEach((b) => {
      const h = parseInt(b.endTime.split(":")[0]);
      const m = parseInt(b.endTime.split(":")[1]);
      const blockEnd = h + (m > 0 ? 1 : 0);
      if (blockEnd > max) {
        max = blockEnd;
      }
    });
    return Math.min(max, 24);
  }, [blocks, endHour]);

  const rowHeight = 26;
  const hours = Array.from({ length: dynamicEndHour - startHour + 1 }, (_, i) => startHour + i);

  function getGridRow(time: string) {
    const [h, m] = time.split(":").map(Number);
    const totalMinutes = (h - startHour) * 60 + m;
    return Math.floor(totalMinutes / 15) + 2;
  }

  function handleSlotClick(dayIndex: number, hourIndex: number, isBlackout: boolean = false, rawSlot?: any) {
    const startHourStr = (startHour + hourIndex).toString().padStart(2, '0');
    const endHourStr = (startHour + hourIndex + 1).toString().padStart(2, '0');
    const clickedDate = weekDates[dayIndex].fullDate;
    const specificDateStr = `${clickedDate.getFullYear()}-${String(clickedDate.getMonth() + 1).padStart(2, '0')}-${String(clickedDate.getDate()).padStart(2, '0')}`;
    
    setActiveSlotAction({
      day: dayIndex + 1, // 1 to 5
      specificDate: specificDateStr,
      start: `${startHourStr}:00`,
      end: `${endHourStr}:00`,
      isBlackout,
      dateStr: `${clickedDate.getFullYear()}년 ${clickedDate.getMonth() + 1}월 ${clickedDate.getDate()}일`,
      startHourStr,
      endHourStr,
      rawSlot: rawSlot || {
        day: dayIndex + 1,
        specificDate: specificDateStr,
        start: `${startHourStr}:00`,
        end: `${endHourStr}:00`,
        isBlackout: false,
      }
    });
  }

  function handleAddCustomTask() {
    if (onAddAdminTask && activeSlotAction && customTaskTitle) {
      onAddAdminTask({
        title: customTaskTitle,
        dayOfWeek: activeSlotAction.day,
        startTime: activeSlotAction.start,
        endTime: activeSlotAction.end
      });
      setCustomTaskTitle("");
      setActiveSlotAction(null);
    }
  }

  function handleToggleBlackout() {
    if (onToggleBlackout && activeSlotAction) {
      onToggleBlackout(activeSlotAction.rawSlot);
      setActiveSlotAction(null);
    }
  }

  function handleCounselingClick(block: any) {
    setSelectedBlock(block);
    setCounselingNote(block.rawReq?.professor_note || "");
    setCounselingLocation(block.rawReq?.location || "");
  }

  function handleUpdateCounseling() {
    if (onUpdateCounseling && selectedBlock?.type === "counseling") {
      onUpdateCounseling(selectedBlock.id, counselingNote, counselingLocation);
      setSelectedBlock(null);
    }
  }

  function handleCancelCounseling() {
    if (onCancelCounseling && selectedBlock?.type === "counseling") {
      if (confirm("정말로 이 상담 일정을 취소하시겠습니까? 학생에게 취소 알림이 전송됩니다.")) {
        onCancelCounseling(selectedBlock.id);
        setSelectedBlock(null);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 font-sans">
      {/* Navigation & Actions */}
      <div className="flex justify-between items-center bg-white/40 backdrop-blur-xl p-3 rounded-xl border border-white/60 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white/60 p-1 rounded-xl shadow-sm border border-white/80">
            <Button variant="ghost" size="icon" onClick={prevWeek} className="h-8 w-8 rounded-lg hover:bg-white/80">
              <ChevronLeft size={18} />
            </Button>
            <span className="font-semibold text-[15px] px-2 text-gray-800">
              {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
            </span>
            <Button variant="ghost" size="icon" onClick={nextWeek} className="h-8 w-8 rounded-lg hover:bg-white/80">
              <ChevronRight size={18} />
            </Button>
          </div>
          
          <div className="flex gap-4 text-xs font-medium text-gray-600 bg-white/50 px-3 py-2 rounded-xl border border-white/50">
            <span className="flex items-center gap-1.5 text-emerald-950">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-100 shadow-sm"></span> 강의
            </span>
            <span className="flex items-center gap-1.5 text-emerald-950">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-100 shadow-sm"></span> 행정
            </span>
            <span className="flex items-center gap-1.5 text-emerald-950">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 shadow-sm"></span> 상담 확정
            </span>
            <span className="flex items-center gap-1.5 text-emerald-950">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-50/80 shadow-sm"></span> 상담 가능
            </span>
          </div>
        </div>

        <Button 
          variant="outline"
          className="rounded-xl bg-white/60 border-white/80 hover:bg-white/90 shadow-sm text-sm h-9"
          onClick={() => {
            alert("데모 시간표 데이터가 로드되었습니다.");
          }}
        >
          샘플 시간표 불러오기
        </Button>
      </div>

      {/* CSS Grid Calendar - Glassmorphism TimeBlocks Style */}
      <div 
        className="relative bg-white/30 backdrop-blur-xl border border-white/50 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns: "50px repeat(5, 1fr)",
          gridTemplateRows: `40px repeat(${(dynamicEndHour - startHour) * 4}, ${rowHeight}px)`,
        }}
      >
        {/* Top-Left Empty Header */}
        <div className="bg-white/40 border-b border-r border-white/40" style={{ gridRow: 1, gridColumn: 1 }}></div>

        {/* Day Headers */}
        {weekDates.map((wd, index) => (
          <div key={wd.label} className="bg-white/40 border-b border-r border-white/40 flex flex-col justify-center items-center py-2" style={{ gridRow: 1, gridColumn: index + 2 }}>
            <span className="font-bold text-[13px] text-gray-700">{wd.label}</span>
            <span className="text-[11px] text-gray-500">{wd.date}</span>
          </div>
        ))}

        {/* Grid Background Lines (Rows) */}
        {hours.map((_, index) => (
          <div 
            key={`grid-line-h-${index}`} 
            className="border-b border-gray-200/40 pointer-events-none"
            style={{ 
              gridRow: `${index * 4 + 2} / span 4`, 
              gridColumn: "1 / -1", 
            }}
          ></div>
        ))}
        {/* Grid Background Lines (Cols) */}
        {weekDates.map((_, index) => (
          <div 
            key={`grid-line-c-${index}`} 
            className="border-r border-gray-200/40 pointer-events-none"
            style={{ 
              gridRow: `2 / -1`, 
              gridColumn: index + 2, 
            }}
          ></div>
        ))}

        {/* Time Labels */}
        {hours.map((hour, index) => (
          <div 
            key={`time-${hour}`} 
            className="bg-white/20 border-r border-white/40 flex justify-center pt-2 text-[11px] font-medium text-gray-500"
            style={{ 
              gridRow: `${index * 4 + 2} / span 4`, 
              gridColumn: 1, 
            }}
          >
            {hour}:00
          </div>
        ))}

        {/* Grid Cells (Empty Slots for Interaction) */}
        {weekDates.map((_, dayIndex) => (
          hours.map((_, hourIndex) => (
            <div 
              key={`cell-${dayIndex}-${hourIndex}`}
              onClick={() => handleSlotClick(dayIndex, hourIndex)}
              className="cursor-pointer hover:bg-black/5 transition-colors duration-200"
              style={{ 
                gridRow: `${hourIndex * 4 + 2} / span 4`, 
                gridColumn: dayIndex + 2,
              }}
              title="클릭하여 일정 추가 또는 차단"
            ></div>
          ))
        ))}

        {/* Time Blocks */}
        {blocks.map((block) => {
          const rowStart = getGridRow(block.startTime);
          const rowEnd = getGridRow(block.endTime);
          const isRecommended = block.type === "recommended";
          const isCounseling = block.type === "counseling";
          
          return (
            <button
              key={block.id}
              onClick={(e) => {
                if (isRecommended) {
                  // open dialog for recommended slots as well
                  e.stopPropagation();
                  handleSlotClick(block.day - 1, parseInt(block.startTime.split(":")[0]) - startHour, block.isBlackout, block.rawSlot);
                } else if (isCounseling) {
                  e.stopPropagation();
                  handleCounselingClick(block);
                } else {
                  e.stopPropagation();
                  setSelectedBlock(block);
                }
              }}
              style={{
                gridRow: `${rowStart} / ${rowEnd}`,
                gridColumn: block.day + 1,
                zIndex: isRecommended ? 5 : 10,
              }}
              className={`w-[calc(100%-4px)] mx-[2px] my-[1px] rounded-md p-1.5 flex flex-col items-start text-left relative overflow-hidden transition-transform hover:scale-[1.01] border ${block.color} ${block.textColor} ${block.borderColor}`}
            >
              <div className="flex items-center gap-1 w-full max-w-full">
                {isCounseling && <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" />}
                <strong className={`text-[11px] leading-tight truncate w-full ${block.isBlackout ? 'line-through opacity-70' : ''}`}>
                  {block.title}
                </strong>
              </div>
              <span className="text-[10.5px] opacity-80 mt-auto font-semibold leading-none pb-[1px] tracking-tight whitespace-nowrap">
                {block.startTime} - {block.endTime}
              </span>
            </button>
          );
        })}
      </div>

      {/* Popover/Dialog for Add Admin / Blackout Interaction */}
      <Dialog open={!!activeSlotAction} onOpenChange={(open) => !open && setActiveSlotAction(null)}>
        <DialogContent className="sm:max-w-md bg-white/80 backdrop-blur-2xl border-white/60 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] rounded-xl p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-gray-500" />
              일정 설정
            </DialogTitle>
            <DialogDescription className="text-gray-500 font-medium">
              {activeSlotAction?.dateStr} {activeSlotAction?.startHourStr}:00 - {activeSlotAction?.endHourStr}:00
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-col gap-3">
            {/* Option A */}
            <div className="group relative p-4 bg-gray-50 hover:bg-gray-100 border border-transparent rounded-xl transition-all">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-blue-100 text-blue-700 rounded-md"><CalendarPlus size={16} /></div>
                <h4 className="font-semibold text-sm text-emerald-950">개인 일정 / 행정업무 추가</h4>
              </div>
              <div className="flex gap-2">
                <Input 
                  placeholder="일정 제목 (예: 학과 회의)" 
                  value={customTaskTitle} 
                  onChange={e => setCustomTaskTitle(e.target.value)} 
                  className="bg-white border-gray-200 focus-visible:ring-emerald-500 rounded-md text-emerald-950"
                />
                <Button onClick={handleAddCustomTask} className="rounded-md bg-emerald-800 hover:bg-emerald-900 text-white shadow-sm">
                  추가
                </Button>
              </div>
            </div>

            {/* Option B */}
            <div className="group relative p-4 bg-gray-50 hover:bg-gray-100 border border-transparent rounded-xl transition-all flex justify-between items-center">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-red-100 text-red-700 rounded-md"><Ban size={16} /></div>
                  <h4 className="font-semibold text-sm text-emerald-950">
                    {activeSlotAction?.isBlackout ? "상담 불가 해제" : "상담 불가 처리"}
                  </h4>
                </div>
                <p className="text-[11px] text-gray-500 ml-9">학생들의 예약 신청을 {activeSlotAction?.isBlackout ? '허용' : '차단'}합니다.</p>
              </div>
              <Button 
                variant={activeSlotAction?.isBlackout ? "outline" : "destructive"} 
                onClick={handleToggleBlackout} 
                className={`rounded-md shadow-sm ${activeSlotAction?.isBlackout ? 'border-gray-200 hover:bg-gray-200 text-emerald-950' : ''}`}
              >
                {activeSlotAction?.isBlackout ? "해제하기" : "차단하기"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Counseling Details Modal */}
      <Dialog open={!!selectedBlock && selectedBlock.type === "counseling"} onOpenChange={(open) => !open && setSelectedBlock(null)}>
        <DialogContent className="sm:max-w-md bg-white/90 backdrop-blur-2xl border-white/60 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] rounded-xl p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              {selectedBlock?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
              <p className="text-sm font-medium text-gray-500 flex items-center gap-1.5 mb-2">
                <Clock size={14} className="text-gray-400" />
                {selectedBlock?.day ? WEEKDAYS[selectedBlock?.day - 1] + "요일" : ""} {selectedBlock?.startTime} ~ {selectedBlock?.endTime} (확정)
              </p>
              <div className="text-sm text-gray-700">
                <strong className="text-gray-900 font-semibold mr-1">학생 메모:</strong> 
                <span className="break-words">{selectedBlock?.details}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-semibold text-emerald-950">상담 장소</Label>
              <Input 
                value={counselingLocation}
                onChange={(e) => setCounselingLocation(e.target.value)}
                placeholder="예) 제1공학관 301호"
                className="bg-white border-gray-200 rounded-md text-emerald-950"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-semibold text-emerald-950">교수 메모</Label>
              <textarea 
                value={counselingNote}
                onChange={(e) => setCounselingNote(e.target.value)}
                placeholder="학생에 대한 개인적인 메모를 남기세요."
                className="flex min-h-[80px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              />
            </div>
            
            <div className="flex justify-between items-center mt-2">
              <Button 
                variant="destructive"
                onClick={handleCancelCounseling}
                className="rounded-md shadow-sm text-xs bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 border border-red-100"
              >
                일정 취소
              </Button>
              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={() => setSelectedBlock(null)}
                  className="rounded-md border-gray-200 text-emerald-950"
                >
                  닫기
                </Button>
                <Button 
                  onClick={handleUpdateCounseling}
                  className="rounded-md bg-emerald-800 hover:bg-emerald-900 text-white shadow-sm"
                >
                  저장
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Read-only details modal for course/admin slots */}
      {selectedBlock && selectedBlock.type !== "counseling" && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[9999] flex justify-center items-center p-4" onClick={() => setSelectedBlock(null)}>
          <div className="bg-white/90 backdrop-blur-xl p-6 rounded-xl max-w-[400px] w-full shadow-2xl border border-white/50" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-800">{selectedBlock.title}</h3>
                <p className="text-sm font-medium text-gray-500 flex items-center gap-1 mt-1">
                  <Clock size={14} />
                  {selectedBlock.day ? WEEKDAYS[selectedBlock.day - 1] + "요일" : ""} {selectedBlock.startTime} ~ {selectedBlock.endTime}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedBlock(null)} className="h-8 w-8 rounded-xl bg-gray-100 hover:bg-gray-200">
                <X size={16} />
              </Button>
            </div>
            
            <div className="p-4 bg-gray-50/80 rounded-xl border border-gray-100 mb-6">
              <p className="text-sm text-gray-700 mb-2"><strong className="text-gray-900 font-semibold mr-1">상세:</strong> {selectedBlock.details}</p>
              <p className="text-sm text-gray-700"><strong className="text-gray-900 font-semibold mr-1">구분:</strong> {selectedBlock.type === "course" ? "강의" : selectedBlock.type === "admin" ? "행정 업무" : "기타"}</p>
            </div>
            
            <div className="flex justify-end gap-2">
              {selectedBlock.type === "course" && selectedBlock.courseId && (
                <Button 
                  variant="outline"
                  onClick={() => router.push(`/roadmap/${selectedBlock.courseId}`)}
                  className="rounded-xl border-gray-200"
                >
                  과목 상세 이동
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
