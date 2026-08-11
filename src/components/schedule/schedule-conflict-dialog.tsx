"use client";

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

export function ScheduleConflictDialog({
  conflict,
  onOpenChange,
  onConfirm,
  onEditTime,
  isPending,
}: {
  conflict: ScheduleConflictInfo | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onEditTime?: () => void;
  isPending?: boolean;
}) {
  return (
    <Dialog open={!!conflict} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>시간표가 겹쳐요</DialogTitle>
          <DialogDescription>아래 시간에 이미 등록된 일정이 있어요. 그래도 추가할까요?</DialogDescription>
        </DialogHeader>
        {conflict ? <ScheduleConflictList conflict={conflict} /> : null}
        <DialogFooter>
          {conflict?.source === "manual" && onEditTime ? (
            <Button type="button" variant="outline" onClick={onEditTime}>
              시간 다시 입력
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? "추가 중..." : "그래도 추가"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
