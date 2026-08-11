"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleCourseFavorite } from "@/services/student-community.actions";

export function FavoriteCourseButton({
  courseId,
  initialFavorite,
}: {
  courseId: string;
  initialFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const nextValue = !isFavorite;
    setIsFavorite(nextValue);

    const formData = new FormData();
    formData.set("courseId", courseId);
    formData.set("nextValue", String(nextValue));

    startTransition(async () => {
      const result = await toggleCourseFavorite(formData);
      if (!result.ok) {
        setIsFavorite(!nextValue);
        alert(result.message);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={isFavorite ? "찜 해제" : "찜하기"}
      aria-pressed={isFavorite}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition hover:border-red-200 hover:text-red-500 disabled:opacity-50"
    >
      <Heart size={16} className={isFavorite ? "fill-red-500 text-red-500" : ""} />
    </button>
  );
}
