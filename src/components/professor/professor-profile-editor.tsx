"use client";

import { useState, useTransition } from "react";
import { updateProfessorProfile } from "@/services/professor.actions";
import type { ProfessorProfile } from "@/services/professor.service";

type ProfessorProfileEditorProps = {
  professor: ProfessorProfile;
};

type EditableProfessorProfile = Pick<ProfessorProfile, "office" | "email" | "bio">;

function toEditableProfile(profile: ProfessorProfile): EditableProfessorProfile {
  return {
    office: profile.office,
    email: profile.email,
    bio: profile.bio,
  };
}

export function ProfessorProfileEditor({ professor: initialProfessor }: ProfessorProfileEditorProps) {
  const [professor, setProfessor] = useState(initialProfessor);
  const [draft, setDraft] = useState(() => toEditableProfile(initialProfessor));
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setDraft(toEditableProfile(professor));
    setMessage(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(toEditableProfile(professor));
    setMessage(null);
    setIsEditing(false);
  }

  function saveProfile() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("office", draft.office ?? "");
      formData.set("email", draft.email ?? "");
      formData.set("bio", draft.bio ?? "");

      const result = await updateProfessorProfile(formData);
      setMessage(result.message);

      if (result.ok && result.professor) {
        setProfessor(result.professor);
        setDraft(toEditableProfile(result.professor));
        setIsEditing(false);
      }
    });
  }

  return (
    <section className="section" aria-labelledby="professor-mypage-title">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 id="professor-mypage-title" className="text-2xl font-bold text-slate-800">
              마이페이지
            </h1>
            <p className="mt-1 text-sm text-slate-500">{professor.name} 교수</p>
          </div>
          {!isEditing ? (
            <button type="button" onClick={startEditing} className="button button-default button-md" disabled={isPending}>
              수정
            </button>
          ) : null}
        </div>

        <dl className="mt-6 grid gap-5 text-sm">
          <div>
            <dt className="font-medium text-slate-500">이름</dt>
            <dd className="mt-1 text-slate-800">{professor.name}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">연구실</dt>
            <dd className="mt-1 text-slate-800">
              {isEditing ? (
                <input
                  aria-label="연구실"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={draft.office ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, office: event.target.value }))}
                />
              ) : (
                professor.office ?? "연구실 미정"
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">이메일</dt>
            <dd className="mt-1 text-slate-800">
              {isEditing ? (
                <input
                  aria-label="이메일"
                  type="email"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={draft.email ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                />
              ) : (
                professor.email ?? "등록된 이메일 없음"
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">소개</dt>
            <dd className="mt-1 whitespace-pre-wrap text-slate-800">
              {isEditing ? (
                <textarea
                  aria-label="소개"
                  className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={draft.bio ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
                />
              ) : (
                professor.bio ?? "등록된 소개 없음"
              )}
            </dd>
          </div>
        </dl>

        {isEditing ? (
          <div className="mt-6 flex items-center gap-3">
            <button type="button" onClick={saveProfile} className="button button-default button-md" disabled={isPending}>
              {isPending ? "저장 중" : "저장"}
            </button>
            <button type="button" onClick={cancelEditing} className="button button-outline button-md" disabled={isPending}>
              취소
            </button>
          </div>
        ) : null}

        {message ? (
          <p className="mt-4 text-sm text-slate-600" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
