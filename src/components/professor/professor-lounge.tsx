"use client";

import { useMemo, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { createProfessorLoungePost } from "@/services/professor-community.actions";
import type { ProfessorLoungePost } from "@/services/professor-community.service";

const loungeCategories = [
  { id: "notice", label: "운영 공유" },
  { id: "question", label: "수업 질문" },
  { id: "case", label: "사례 공유" },
  { id: "free", label: "자유" },
];

export function ProfessorLounge({ posts }: { posts: ProfessorLoungePost[] }) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [category, setCategory] = useState("notice");
  const [displayMode, setDisplayMode] = useState("anonymous");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredPosts = useMemo(
    () =>
      selectedCategory === "all"
        ? posts
        : posts.filter((post) => post.category === selectedCategory),
    [posts, selectedCategory],
  );

  function submitPost() {
    const formData = new FormData();
    formData.set("category", category);
    formData.set("displayMode", displayMode);
    formData.set("title", title);
    formData.set("content", content);

    setMessage("");
    startTransition(async () => {
      const result = await createProfessorLoungePost(formData);
      setMessage(result.message);
      if (result.ok) {
        setTitle("");
        setContent("");
      }
    });
  }

  return (
    <section className="section professor-lounge-layout">
      <aside className="professor-lounge-compose">
        <div className="community-section-heading">
          <h2>글쓰기</h2>
          <span>교수 전용</span>
        </div>
        <div className="professor-lounge-options">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {loungeCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value)}>
            <option value="anonymous">익명</option>
            <option value="realname">실명</option>
          </select>
        </div>
        <input
          onChange={(event) => setTitle(event.target.value)}
          placeholder="제목"
          value={title}
        />
        <textarea
          onChange={(event) => setContent(event.target.value)}
          placeholder="교수님들끼리 공유할 수업 운영, 상담, 행정 팁을 남겨보세요."
          rows={7}
          value={content}
        />
        <button
          className="button button-default button-md"
          disabled={isPending}
          onClick={submitPost}
          type="button"
        >
          {isPending ? "등록 중" : "등록"}
          <Send size={15} aria-hidden="true" />
        </button>
        {message ? <p className="support-result">{message}</p> : null}
      </aside>

      <main className="professor-lounge-feed">
        <div className="professor-lounge-filter">
          <button
            data-active={selectedCategory === "all"}
            onClick={() => setSelectedCategory("all")}
            type="button"
          >
            전체
          </button>
          {loungeCategories.map((item) => (
            <button
              data-active={selectedCategory === item.id}
              key={item.id}
              onClick={() => setSelectedCategory(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="professor-lounge-list">
          {filteredPosts.length ? (
            filteredPosts.map((post) => (
              <article key={post.id}>
                <span>{loungeCategories.find((item) => item.id === post.category)?.label ?? post.category}</span>
                <strong>{post.title}</strong>
                <p>{post.content}</p>
                <small>
                  {post.display_mode === "anonymous"
                    ? post.anonymous_alias ?? "익명 교수"
                    : post.author?.name ?? "교수"}{" "}
                  · {new Date(post.created_at).toLocaleDateString("ko-KR")}
                </small>
              </article>
            ))
          ) : (
            <div className="community-empty">
              <p>아직 등록된 글이 없습니다.</p>
            </div>
          )}
        </div>
      </main>
    </section>
  );
}
