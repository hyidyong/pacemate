"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addCourseToSchedule } from "@/services/student-community.actions";
import { Plus } from "lucide-react";
import { RegisterCourseDialog, type EditableScheduleSlot } from "@/components/courses/register-course-dialog";
import type { ScheduleConflictInfo } from "@/components/schedule/schedule-conflict-list";

export function RegisterCourseButton({ courseId }: { courseId: string }) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [conflict, setConflict] = useState<ScheduleConflictInfo | null>(null);
  const [lastFormData, setLastFormData] = useState<FormData | null>(null);

  function submit(formData: FormData) {
    setLastFormData(formData);
    startTransition(async () => {
      const result = await addCourseToSchedule(formData);

      if (result.ok) {
        setDialogOpen(false);
        setConflict(null);
        alert("내 시간표에 추가되었습니다!");
        return;
      }

      if ("needsManualEntry" in result && result.needsManualEntry) {
        setConflict(null);
        setDialogOpen(true);
        return;
      }

      if ("conflict" in result && result.conflict) {
        setConflict(result.conflict);
        setDialogOpen(true);
        return;
      }

      alert(result.message);
    });
  }

  function handleRegisterClick() {
    const formData = new FormData();
    formData.set("courseId", courseId);
    submit(formData);
  }

  function handleManualEntrySubmit(slots: EditableScheduleSlot[]) {
    const formData = new FormData();
    formData.set("courseId", courseId);
    formData.set(
      "scheduleSlots",
      JSON.stringify(
        slots.map((slot) => ({
          dayOfWeek: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          classroom: slot.classroom,
        })),
      ),
    );
    submit(formData);
  }

  function handleConfirmOverlap() {
    if (!lastFormData) return;
    const formData = new FormData();
    lastFormData.forEach((value, key) => formData.set(key, value as string));
    formData.set("confirmOverlap", "true");
    submit(formData);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleRegisterClick}
      >
        <Plus size={16} className="mr-1" />
        {isPending ? "등록 중..." : "내 시간표에 추가"}
      </Button>
      <RegisterCourseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleManualEntrySubmit}
        conflict={conflict}
        onConfirmOverlap={handleConfirmOverlap}
        onEditTime={() => setConflict(null)}
        isPending={isPending}
      />
    </>
  );
}
