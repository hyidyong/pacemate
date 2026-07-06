"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export async function createProfessorLoungePost(formData: FormData) {
  const profile = await getDemoProfile();
  const category = text(formData.get("category"), "notice");
  const displayMode = text(formData.get("displayMode"), "anonymous");
  const title = text(formData.get("title"));
  const content = text(formData.get("content"));

  if (profile?.role !== "professor") {
    return { ok: false, message: "교수 계정으로 로그인해야 이용할 수 있습니다." };
  }

  if (!title || content.length < 5) {
    return { ok: false, message: "제목과 내용을 조금 더 구체적으로 입력해 주세요." };
  }

  const { error } = await supabase.from("posts").insert({
    author_id: profile.id,
    school_id: profile.school_id,
    category,
    board_key: "professor",
    title,
    content,
    display_mode: displayMode,
    anonymous_alias: displayMode === "anonymous" ? "익명 교수" : null,
    status: "active",
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/professor/lounge");
  return { ok: true, message: "교수 라운지에 글을 등록했습니다." };
}
