"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScheduleConflictList, type ScheduleConflictInfo } from "@/components/schedule/schedule-conflict-list";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

export type EditableScheduleSlot = {
  day: string;
  startTime: string;
  endTime: string;
  classroom: string;
};

function createEmptySlot(): EditableScheduleSlot {
  return { day: DAYS[0], startTime: "09:00", endTime: "10:15", classroom: "" };
}

export function RegisterCourseDialog({
  open,
  onOpenChange,
  onSubmit,
  conflict,
  onConfirmOverlap,
  onEditTime,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (slots: EditableScheduleSlot[]) => void;
  conflict: ScheduleConflictInfo | null;
  onConfirmOverlap: () => void;
  onEditTime: () => void;
  isPending?: boolean;
}) {
  const [slots, setSlots] = useState<EditableScheduleSlot[]>([createEmptySlot()]);

  function updateSlot(index: number, patch: Partial<EditableScheduleSlot>) {
    setSlots((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  function addSlot() {
    setSlots((prev) => [...prev, createEmptySlot()]);
  }

  function removeSlot(index: number) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {conflict ? (
          <>
            <DialogHeader>
              <DialogTitle>시간표가 겹쳐요</DialogTitle>
              <DialogDescription>아래 시간에 이미 등록된 일정이 있어요. 그래도 추가할까요?</DialogDescription>
            </DialogHeader>
            <ScheduleConflictList conflict={conflict} />
            <DialogFooter>
              {conflict.source === "manual" ? (
                <Button type="button" variant="outline" onClick={onEditTime}>
                  시간 다시 입력
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="button" onClick={onConfirmOverlap} disabled={isPending}>
                {isPending ? "추가 중..." : "그래도 추가"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>수업 시간을 입력해 주세요</DialogTitle>
              <DialogDescription>
                이 과목은 등록된 시간표 정보를 찾지 못했어요. 요일과 시간을 직접 입력해 주세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {slots.map((slot, index) => (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[0.8fr_1fr_1fr_1.2fr_auto] sm:items-center"
                >
                  <select
                    aria-label={`${index + 1}번째 시간 요일`}
                    value={slot.day}
                    onChange={(event) => updateSlot(index, { day: event.target.value })}
                    className="rounded-md border px-2 py-1.5 text-sm"
                  >
                    {DAYS.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`${index + 1}번째 시간 시작`}
                    type="time"
                    value={slot.startTime}
                    onChange={(event) => updateSlot(index, { startTime: event.target.value })}
                    className="rounded-md border px-2 py-1.5 text-sm"
                  />
                  <input
                    aria-label={`${index + 1}번째 시간 종료`}
                    type="time"
                    value={slot.endTime}
                    onChange={(event) => updateSlot(index, { endTime: event.target.value })}
                    className="rounded-md border px-2 py-1.5 text-sm"
                  />
                  <input
                    aria-label={`${index + 1}번째 시간 강의실`}
                    type="text"
                    placeholder="강의실"
                    value={slot.classroom}
                    onChange={(event) => updateSlot(index, { classroom: event.target.value })}
                    className="rounded-md border px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeSlot(index)}
                    disabled={slots.length === 1}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                    aria-label={`${index + 1}번째 시간 삭제`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addSlot}>
                <Plus size={14} className="mr-1" />
                시간 추가
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="button" onClick={() => onSubmit(slots)} disabled={isPending}>
                {isPending ? "추가 중..." : "추가"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
