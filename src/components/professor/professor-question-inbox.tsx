"use client";

import { useMemo, useState, useTransition } from "react";
import { Bot, CheckSquare, MessageSquareText, Trash2 } from "lucide-react";
import {
  answerProfessorQuestions,
  draftGroundedProfessorAnswer,
  deleteProfessorAutoReplyRule,
  saveProfessorAutoReplyRule,
  toggleProfessorAutoReplyRule,
} from "@/services/professor-question.actions";
import {
  professorQuestionCategories,
  type ProfessorQuestionCategory,
  type ProfessorQuestionCourseOption,
  type ProfessorQuestionInbox,
} from "@/types/professor-questions";

export function ProfessorQuestionInboxView({
  inbox,
  courses,
}: {
  inbox: ProfessorQuestionInbox;
  courses: ProfessorQuestionCourseOption[];
}) {
  const [category, setCategory] = useState<ProfessorQuestionCategory>(professorQuestionCategories[0]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [draftSources, setDraftSources] = useState<Array<{ type: string; label: string }>>([]);
  const [isPending, startTransition] = useTransition();
  const groups = useMemo(
    () => inbox.groups.filter((group) => group.category === category),
    [category, inbox.groups],
  );

  function toggleQuestion(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectPendingGroup(ids: string[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function submitBulkAnswer() {
    if (!selectedIds.size || !answer.trim()) return;
    const formData = new FormData();
    for (const id of selectedIds) formData.append("questionId", id);
    formData.set("answer", answer);
    startTransition(async () => {
      const result = await answerProfessorQuestions(formData);
      setMessage(result.message);
      if (result.ok) {
        setSelectedIds(new Set());
        setAnswer("");
      }
    });
  }

  function createGroundedDraft() {
    if (selectedIds.size !== 1) return;
    const formData = new FormData();
    formData.set("questionId", [...selectedIds][0]);
    startTransition(async () => {
      const result = await draftGroundedProfessorAnswer(formData);
      if (result.ok) {
        setMessage("교수 검토가 필요한 AI 초안을 만들었습니다.");
        setAnswer(result.draft);
        setDraftSources(result.sources);
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="professor-panel" aria-labelledby="question-inbox-title">
        <div className="community-section-heading">
          <h2 id="question-inbox-title">들어온 질문</h2>
          <MessageSquareText size={18} aria-hidden="true" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="질문 분류">
          {professorQuestionCategories.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              onClick={() => setCategory(item)}
              className={`rounded-full border px-3 py-1.5 text-sm ${category === item ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-gray-200"}`}
            >
              {item} {inbox.categoryCounts[item]}
            </button>
          ))}
        </div>

        {groups.length ? (
          <div className="mt-5 space-y-4">
            {groups.map((group, groupIndex) => {
              const pendingIds = group.questions
                .filter((question) => question.status === "pending" || question.status === "assigned")
                .map((question) => question.id);
              return (
                <article key={group.key} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-gray-500">{group.courseName} · 같은 정규화 질문 그룹 {groupIndex + 1}</p>
                      <h3 className="mt-1 font-semibold text-gray-900">{group.questions[0]?.question}</h3>
                      <p className="mt-1 text-sm text-gray-600">총 {group.questions.length}건 · 답변 대기 {group.pendingCount}건</p>
                    </div>
                    {pendingIds.length ? (
                      <button
                        type="button"
                        className="rounded-md border px-3 py-1.5 text-sm"
                        onClick={() => selectPendingGroup(pendingIds)}
                      >
                        그룹 대기 질문 선택
                      </button>
                    ) : null}
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-emerald-800">개별 질문 열기</summary>
                    <div className="mt-3 space-y-2">
                      {group.questions.map((question, index) => {
                        const isAnswerable = question.status === "pending" || question.status === "assigned";
                        return (
                          <label key={question.id} className="flex gap-3 rounded-lg bg-gray-50 p-3 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(question.id)}
                              disabled={!isAnswerable}
                              onChange={() => toggleQuestion(question.id)}
                            />
                            <span>
                              <strong>질문 {index + 1}</strong>
                              <span className="mt-1 block whitespace-pre-wrap text-gray-700">{question.question}</span>
                              {question.answer ? (
                                <span className="mt-2 block text-emerald-800">
                                  {question.answerMode === "automatic" ? "자동 답변" : "교수 답변"}: {question.answer}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="community-empty mt-5"><p>이 분류에 표시할 질문이 없습니다.</p></div>
        )}

        <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 font-semibold text-emerald-950">
            <CheckSquare size={17} aria-hidden="true" /> 선택 질문 일괄 답변 ({selectedIds.size})
          </div>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={4000}
            rows={4}
            placeholder="선택한 질문에 적용할 답변"
            className="mt-3 w-full rounded-md border bg-white p-3 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={createGroundedDraft}
              disabled={isPending || selectedIds.size !== 1}
              className="rounded-md border border-emerald-700 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
            >
              근거 기반 AI 초안
            </button>
          </div>
          {draftSources.length ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3 text-xs text-gray-600">
              <strong className="text-gray-800">사용 근거</strong>
              <ul className="mt-1 list-disc pl-5">
                {draftSources.map((source, index) => <li key={`${source.type}-${index}`}>{source.label}</li>)}
              </ul>
              <p className="mt-2 text-amber-700">AI 초안은 자동 전송되지 않으며 교수 검토·수정 후에만 답변됩니다.</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={submitBulkAnswer}
            disabled={isPending || !selectedIds.size || !answer.trim()}
            className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            선택 질문에 답변
          </button>
        </div>
      </section>

      <AutoReplyRules inbox={inbox} courses={courses} isPending={isPending} run={startTransition} setMessage={setMessage} />
      {message ? <p className="mypage-message" aria-live="polite">{message}</p> : null}
    </div>
  );
}

function AutoReplyRules({
  inbox,
  courses,
  isPending,
  run,
  setMessage,
}: {
  inbox: ProfessorQuestionInbox;
  courses: ProfessorQuestionCourseOption[];
  isPending: boolean;
  run: (callback: () => Promise<void>) => void;
  setMessage: (message: string) => void;
}) {
  const [courseId, setCourseId] = useState("");
  const [category, setCategory] = useState<ProfessorQuestionCategory>("수업 운영");
  const [pattern, setPattern] = useState("");
  const [answer, setAnswer] = useState("");
  const [editingRuleId, setEditingRuleId] = useState("");

  function runRuleAction(action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, formData: FormData) {
    run(async () => {
      const result = await action(formData);
      setMessage(result.message);
      if (result.ok && action === saveProfessorAutoReplyRule) {
        setPattern("");
        setAnswer("");
        setEditingRuleId("");
      }
    });
  }

  function saveRule() {
    const formData = new FormData();
    formData.set("ruleId", editingRuleId);
    formData.set("courseId", courseId);
    formData.set("category", category);
    formData.set("pattern", pattern);
    formData.set("answer", answer);
    runRuleAction(saveProfessorAutoReplyRule, formData);
  }

  return (
    <section className="professor-panel" aria-labelledby="auto-reply-title">
      <div className="community-section-heading">
        <h2 id="auto-reply-title">자동 답변 규칙</h2>
        <Bot size={18} aria-hidden="true" />
      </div>
      <p className="mt-2 text-sm text-gray-600">분류와 정규화된 문구가 명시적으로 포함될 때만 자동 답변합니다.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="rounded-md border p-2 text-sm">
          <option value="">모든 담당 과목</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value as ProfessorQuestionCategory)} className="rounded-md border p-2 text-sm">
          {professorQuestionCategories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input value={pattern} onChange={(event) => setPattern(event.target.value)} maxLength={200} placeholder="일치할 문구 (2자 이상)" className="rounded-md border p-2 text-sm" />
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={4000} placeholder="자동 답변" rows={3} className="rounded-md border p-2 text-sm" />
      </div>
      <button type="button" onClick={saveRule} disabled={isPending || pattern.trim().length < 2 || !answer.trim()} className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {editingRuleId ? "규칙 수정" : "규칙 추가"}
      </button>

      <div className="mt-5 space-y-2">
        {inbox.rules.map((rule) => (
          <article key={rule.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <strong>{rule.pattern}</strong>
              <p className="text-gray-600">{rule.courseName ?? "모든 담당 과목"} · {rule.category}</p>
              <p className="mt-1">{rule.answer}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => {
                  setEditingRuleId(rule.id);
                  setCourseId(rule.courseId ?? "");
                  setCategory(rule.category);
                  setPattern(rule.pattern);
                  setAnswer(rule.answer);
                }}
              >
                편집
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => {
                  const formData = new FormData();
                  formData.set("ruleId", rule.id);
                  formData.set("enabled", String(!rule.isEnabled));
                  runRuleAction(toggleProfessorAutoReplyRule, formData);
                }}
              >
                {rule.isEnabled ? "끄기" : "켜기"}
              </button>
              <button
                type="button"
                aria-label="자동 답변 규칙 삭제"
                className="rounded-md border p-2 text-red-600"
                onClick={() => {
                  const formData = new FormData();
                  formData.set("ruleId", rule.id);
                  runRuleAction(deleteProfessorAutoReplyRule, formData);
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
        {!inbox.rules.length ? <p className="text-sm text-gray-500">등록된 자동 답변 규칙이 없습니다.</p> : null}
      </div>
    </section>
  );
}
