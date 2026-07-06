"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addCourseToSchedule } from "@/services/course.actions";
import { Plus } from "lucide-react";

export function RegisterCourseButton({ courseId }: { courseId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button 
      variant="outline" 
      size="sm" 
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await addCourseToSchedule(courseId);
          if (result.error) {
            alert(result.error);
          } else {
            alert("내 시간표에 추가되었습니다!");
          }
        });
      }}
    >
      <Plus size={16} className="mr-1" />
      {isPending ? "등록 중..." : "내 시간표에 추가"}
    </Button>
  );
}
