"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type React from "react";
import {
  Bookmark,
  Bot,
  ChevronRight,
  Flame,
  MessageCircle,
  PencilLine,
  Search,
  Send,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  addCommunityComment,
  createCommunityPost,
  togglePostReaction,
} from "@/services/student-community.actions";
import type {
  CommunityPostRecord,
  CourseRecord,
  StudentCourseRecord,
} from "@/services/student-community.service";

type CommunityBoardProps = {
  schoolName: string;
  profileId?: string;
  courses: CourseRecord[];
  myCourses: StudentCourseRecord[];
  initialPosts: CommunityPostRecord[];
  initialCourseId?: string;
  initialPostId?: string;
};

type BoardKey = "all" | "question" | "study" | "review" | "notice";
type DisplayMode = "anonymous" | "nickname" | "real_name";

const boards: Array<{ id: BoardKey; label: string; description: string }> = [
  { id: "all", label: "전체", description: "우리 대학 전체 글" },
  { id: "question", label: "질문", description: "수업/과제/시험 질문" },
  { id: "study", label: "스터디", description: "공부 모임과 자료 공유" },
  { id: "review", label: "후기", description: "수강 경험과 팁" },
  { id: "notice", label: "공지", description: "조교/관리자 안내" },
];

const boardLabel = Object.fromEntries(
  boards.map((board) => [board.id, board.label]),
) as Record<BoardKey, string>;

function getDraftKey(profileId?: string) {
  return `pacemate-community-draft-${profileId ?? "guest"}`;
}

function scorePost(post: CommunityPostRecord, source: string) {
  const sourceWords = source
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const haystack = [
    post.title,
    post.content,
    post.course?.name ?? "",
    post.category,
  ]
    .join(" ")
    .toLowerCase();

  return sourceWords.reduce(
    (score, word) => score + (haystack.includes(word) ? 1 : 0),
    0,
  );
}

function getAiSuggestion(title: string, content: string, courseName?: string) {
  const text = `${title} ${content}`;

  if (!text.trim()) {
    return "제목과 내용을 입력하면 강의계획서/기초지식 기준으로 먼저 확인할 답변 방향을 제안합니다.";
  }

  if (text.includes("증명") || text.includes("기판력")) {
    return `${courseName ?? "해당 과목"} 질문은 개념 정의 → 요건 → 예외 → 사례 적용 순서로 정리하면 좋습니다. 강의계획서의 관련 주차와 기존 질문을 먼저 확인해보세요.`;
  }

  if (text.includes("스터디") || text.includes("목차")) {
    return "스터디 글은 시간, 방식, 준비물, 원하는 인원을 먼저 쓰면 참여자가 빠르게 판단할 수 있습니다.";
  }

  return "AI 제안: 과목명, 현재 막힌 지점, 이미 찾아본 자료를 함께 쓰면 답변 품질이 좋아집니다.";
}

export function CommunityBoard({
  schoolName,
  profileId,
  courses,
  myCourses = [],
  initialPosts,
  initialCourseId,
  initialPostId,
}: CommunityBoardProps) {
  const [posts, setPosts] = useState(initialPosts);
  const [selectedBoard, setSelectedBoard] = useState<BoardKey>("all");
  const [selectedCourseId, setSelectedCourseId] = useState(initialCourseId ?? "all");
  const [selectedPostId, setSelectedPostId] = useState(initialPostId ?? initialPosts[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [previewPostId, setPreviewPostId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftCourseId, setDraftCourseId] = useState(initialCourseId ?? "");
  const [draftCategory, setDraftCategory] = useState<Exclude<BoardKey, "all">>("question");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("anonymous");
  const [commentDraft, setCommentDraft] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const saved = window.localStorage.getItem(getDraftKey(profileId));
    if (!saved) {
      return;
    }

    try {
      const draft = JSON.parse(saved) as {
        title?: string;
        content?: string;
        courseId?: string;
        category?: Exclude<BoardKey, "all">;
        displayMode?: DisplayMode;
      };
      setDraftTitle(draft.title ?? "");
      setDraftContent(draft.content ?? "");
      setDraftCourseId(draft.courseId ?? initialCourseId ?? "");
      setDraftCategory(draft.category ?? "question");
      setDisplayMode(draft.displayMode ?? "anonymous");
    } catch {
      window.localStorage.removeItem(getDraftKey(profileId));
    }
  }, [initialCourseId, profileId]);

  useEffect(() => {
    window.localStorage.setItem(
      getDraftKey(profileId),
      JSON.stringify({
        title: draftTitle,
        content: draftContent,
        courseId: draftCourseId,
        category: draftCategory,
        displayMode,
      }),
    );
  }, [displayMode, draftCategory, draftContent, draftCourseId, draftTitle, profileId]);

  const myCourseIds = useMemo(
    () => new Set(myCourses.map((item) => item.course.id)),
    [myCourses],
  );

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return posts.filter((post) => {
      const boardMatches =
        selectedBoard === "all" || post.board_key === selectedBoard;
      const courseMatches =
        selectedCourseId === "all" ||
        (selectedCourseId === "mine"
          ? post.course_id && myCourseIds.has(post.course_id)
          : post.course_id === selectedCourseId);
      const queryMatches =
        !normalizedQuery ||
        [post.title, post.content, post.course?.name ?? "", post.category]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return boardMatches && courseMatches && queryMatches;
    });
  }, [myCourseIds, posts, query, selectedBoard, selectedCourseId]);

  const selectedPost =
    posts.find((post) => post.id === selectedPostId) ?? filteredPosts[0] ?? posts[0];

  const hotPosts = useMemo(
    () =>
      [...posts]
        .sort((a, b) => b.view_count + b.likes * 8 + b.scraps * 6 - (a.view_count + a.likes * 8 + a.scraps * 6))
        .slice(0, 4),
    [posts],
  );

  const recommendedPosts = useMemo(
    () =>
      posts
        .filter((post) => post.course_id && myCourseIds.has(post.course_id))
        .slice(0, 4),
    [myCourseIds, posts],
  );

  const similarPosts = useMemo(() => {
    const source = `${draftTitle} ${draftContent}`.trim();
    if (!source) {
      return [];
    }

    return posts
      .map((post) => ({ post, score: scorePost(post, source) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((item) => item.post);
  }, [draftContent, draftTitle, posts]);

  const previewPost = posts.find((post) => post.id === previewPostId);
  const draftCourse = courses.find((course) => course.id === draftCourseId);
  const aiSuggestion = getAiSuggestion(draftTitle, draftContent, draftCourse?.name);

  function openComposer() {
    setComposerOpen(true);
    setReviewMode(false);
    setPreviewPostId("");
    setMessage("");
  }

  function continueToReview() {
    if (!draftTitle.trim() || !draftContent.trim()) {
      setMessage("제목과 내용을 입력해주세요.");
      return;
    }

    setReviewMode(true);
    setMessage("");
  }

  function submitPost() {
    const formData = new FormData();
    formData.set("title", draftTitle);
    formData.set("content", draftContent);
    formData.set("category", draftCategory);
    formData.set("courseId", draftCourseId);
    formData.set("schoolId", courses[0]?.school_id ?? "");
    formData.set("displayMode", displayMode);

    startTransition(async () => {
      const result = await createCommunityPost(formData);
      setMessage(result.message);
      if (result.ok && result.postId) {
        const newPost: CommunityPostRecord = {
          id: result.postId,
          author_id: profileId ?? null,
          school_id: courses[0]?.school_id ?? null,
          course_id: draftCourseId || null,
          category: draftCategory,
          board_key: draftCategory,
          title: draftTitle.trim(),
          content: draftContent.trim(),
          display_mode: displayMode,
          anonymous_alias: displayMode === "anonymous" ? "익명" : null,
          view_count: 0,
          is_resolved: false,
          created_at: new Date().toISOString(),
          course: draftCourse
            ? { id: draftCourse.id, code: draftCourse.code, name: draftCourse.name }
            : null,
          author: null,
          likes: 0,
          scraps: 0,
          comments: 0,
          is_liked: false,
          is_scrapped: false,
        };
        setPosts((current) => [newPost, ...current]);
        setSelectedPostId(newPost.id);
        setSelectedBoard("all");
        setSelectedCourseId("all");
        setDraftTitle("");
        setDraftContent("");
        setReviewMode(false);
        setComposerOpen(false);
        window.localStorage.removeItem(getDraftKey(profileId));
      }
    });
  }

  function handleReaction(post: CommunityPostRecord, type: "like" | "scrap") {
    const formData = new FormData();
    formData.set("postId", post.id);
    formData.set("type", type);

    startTransition(async () => {
      const result = await togglePostReaction(formData);
      if (!result.ok || typeof result.active !== "boolean") {
        setMessage(result.message);
        return;
      }

      const delta = result.active ? 1 : -1;
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                likes: type === "like" ? Math.max(0, item.likes + delta) : item.likes,
                scraps: type === "scrap" ? Math.max(0, item.scraps + delta) : item.scraps,
                is_liked: type === "like" ? result.active : item.is_liked,
                is_scrapped: type === "scrap" ? result.active : item.is_scrapped,
              }
            : item,
        ),
      );
      setMessage(result.message);
    });
  }

  function submitComment(post: CommunityPostRecord) {
    if (!commentDraft.trim()) {
      setMessage("댓글 내용을 입력해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.set("postId", post.id);
    formData.set("content", commentDraft);
    formData.set("displayMode", "anonymous");

    startTransition(async () => {
      const result = await addCommunityComment(formData);
      setMessage(result.message);
      if (result.ok) {
        setCommentDraft("");
        setPosts((current) =>
          current.map((item) =>
            item.id === post.id ? { ...item, comments: item.comments + 1 } : item,
          ),
        );
      }
    });
  }

  return (
    <section className="section community-board" data-testid="community-board">
      <div className="community-university-bar">
        <div>
          <span>우리 대학</span>
          <strong>{schoolName}</strong>
        </div>
        <label className="community-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="게시글 검색"
            data-testid="community-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="게시판, 과목, 키워드 검색"
            value={query}
          />
        </label>
      </div>

      <div className="community-everytime-layout">
        <aside className="community-board-menu">
          <div className="community-section-heading">
            <h2>게시판</h2>
            <span>{filteredPosts.length}개</span>
          </div>
          {boards.map((board) => (
            <button
              data-selected={selectedBoard === board.id}
              data-testid={`community-tab-${board.id}`}
              key={board.id}
              onClick={() => setSelectedBoard(board.id)}
              type="button"
            >
              <strong>{board.label}</strong>
              <span>{board.description}</span>
            </button>
          ))}
          <div className="community-course-filter">
            <strong>과목별 보기</strong>
            <select
              data-testid="community-course-filter"
              onChange={(event) => setSelectedCourseId(event.target.value)}
              value={selectedCourseId}
            >
              <option value="all">전체 과목</option>
              <option value="mine">내 시간표 과목</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <main className="community-feed" aria-label="게시글 목록">
          <div className="community-section-heading">
            <h2>{selectedBoard === "all" ? "전체 게시글" : `${boardLabel[selectedBoard]} 게시판`}</h2>
            <span>{filteredPosts.length}개</span>
          </div>
          {filteredPosts.length ? (
            <div className="community-post-list">
              {filteredPosts.map((post) => (
                <button
                  className="community-post-button"
                  data-selected={selectedPost?.id === post.id}
                  data-testid={`community-post-${post.id}`}
                  key={post.id}
                  onClick={() => setSelectedPostId(post.id)}
                  type="button"
                >
                  <span className="community-post-meta">
                    <span>{boardLabel[(post.board_key as BoardKey) || "question"] ?? post.category}</span>
                    {post.course ? <span>{post.course.name}</span> : <span>전체</span>}
                    <span>{post.anonymous_alias ?? "익명"}</span>
                  </span>
                  <strong>{post.title}</strong>
                  <p>{post.content}</p>
                  <span className="community-post-stats">
                    <span>좋아요 {post.likes}</span>
                    <span>댓글 {post.comments}</span>
                  </span>
                  <ChevronRight className="community-post-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className="community-empty">
              <p>조건에 맞는 게시글이 없습니다. 검색어를 줄이거나 전체 과목을 확인해보세요.</p>
            </div>
          )}
        </main>

        <aside className="community-side">
          <PostRail
            icon={<Flame size={17} aria-hidden="true" />}
            posts={hotPosts}
            title="핫게"
            onSelect={setSelectedPostId}
          />
          <PostRail
            icon={<Bookmark size={17} aria-hidden="true" />}
            posts={recommendedPosts.length ? recommendedPosts : hotPosts.slice(0, 2)}
            title="내 과목 추천"
            onSelect={setSelectedPostId}
          />
          <article className="community-detail" data-testid="community-detail">
            {selectedPost ? (
              <>
                <header>
                  <span className="community-post-meta">
                    <span>{boardLabel[(selectedPost.board_key as BoardKey) || "question"]}</span>
                    <span>{selectedPost.course?.name ?? "전체"}</span>
                  </span>
                  <h2>{selectedPost.title}</h2>
                  <p>{selectedPost.anonymous_alias ?? "익명"} · 조회 {selectedPost.view_count}</p>
                </header>
                <p className="community-detail-content">{selectedPost.content}</p>
                <div className="community-actions">
                  <button onClick={() => handleReaction(selectedPost, "like")} type="button">
                    <ThumbsUp size={16} aria-hidden="true" />
                    {selectedPost.is_liked ? "좋아요 취소" : "좋아요"} {selectedPost.likes}
                  </button>
                  <button onClick={() => handleReaction(selectedPost, "scrap")} type="button">
                    <Bookmark size={16} aria-hidden="true" />
                    {selectedPost.is_scrapped ? "스크랩 해제" : "스크랩"} {selectedPost.scraps}
                  </button>
                </div>
                <div className="community-comment-box">
                  <strong>댓글 {selectedPost.comments}</strong>
                  <textarea
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="댓글을 입력해 주세요"
                    rows={3}
                    value={commentDraft}
                  />
                  <button
                    className="button button-default button-sm"
                    disabled={isPending}
                    onClick={() => submitComment(selectedPost)}
                    type="button"
                  >
                    댓글 등록
                    <Send size={14} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <p>게시글을 선택해주세요.</p>
            )}
          </article>
        </aside>
      </div>

      <button
        className="community-write-fab"
        data-testid="community-write-fab"
        onClick={openComposer}
        type="button"
      >
        <PencilLine size={20} aria-hidden="true" />
        <span>글쓰기</span>
      </button>

      {composerOpen ? (
        <div className="community-composer-backdrop" role="presentation">
          <section className="community-composer" aria-label="글쓰기">
            <header>
              <div>
                <span>{reviewMode ? "유사 글 확인" : "글쓰기"}</span>
                <h2>{schoolName} 커뮤니티</h2>
              </div>
              <button aria-label="닫기" onClick={() => setComposerOpen(false)} type="button">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            {previewPost ? (
              <article className="community-similar-preview">
                <button onClick={() => setPreviewPostId("")} type="button">
                  작성 화면으로 돌아가기
                </button>
                <strong>{previewPost.title}</strong>
                <p>{previewPost.content}</p>
                <div className="community-actions">
                  <button
                    onClick={() => {
                      setMessage("기존 글로 해결 처리했습니다. 작성 중인 글은 임시저장되어 있습니다.");
                      setPreviewPostId("");
                      setComposerOpen(false);
                    }}
                    type="button"
                  >
                    이 글로 해결
                  </button>
                  <button onClick={() => setPreviewPostId("")} type="button">
                    계속 작성
                  </button>
                </div>
              </article>
            ) : (
              <>
                <div className="community-compose-grid">
                  <label className="field">
                    <span>게시판</span>
                    <select
                      data-testid="community-compose-category"
                      onChange={(event) =>
                        setDraftCategory(event.target.value as Exclude<BoardKey, "all">)
                      }
                      value={draftCategory}
                    >
                      {boards
                        .filter((board) => board.id !== "all")
                        .map((board) => (
                          <option key={board.id} value={board.id}>
                            {board.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>과목</span>
                    <select
                      data-testid="community-compose-course"
                      onChange={(event) => setDraftCourseId(event.target.value)}
                      value={draftCourseId}
                    >
                      <option value="">대학 전체</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>작성자 표시</span>
                    <select
                      data-testid="community-compose-display"
                      onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}
                      value={displayMode}
                    >
                      <option value="anonymous">익명</option>
                      <option value="nickname">닉네임</option>
                      <option value="real_name">실명</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>제목</span>
                  <input
                    data-testid="community-compose-title"
                    onChange={(event) => setDraftTitle(event.target.value)}
                    placeholder="예: 증명책임 정리 순서가 헷갈려요"
                    value={draftTitle}
                  />
                </label>
                <label className="field">
                  <span>내용</span>
                  <textarea
                    data-testid="community-compose-content"
                    onChange={(event) => setDraftContent(event.target.value)}
                    placeholder="질문, 이미 찾아본 자료, 원하는 답변 범위를 적어주세요."
                    rows={6}
                    value={draftContent}
                  />
                </label>

                <div className="community-ai-suggestion">
                  <Bot size={18} aria-hidden="true" />
                  <p>{aiSuggestion}</p>
                </div>

                {reviewMode ? (
                  <div className="community-similar">
                    <strong>작성 전 유사 글</strong>
                    {similarPosts.length ? (
                      similarPosts.map((post) => (
                        <button
                          key={post.id}
                          onClick={() => setPreviewPostId(post.id)}
                          type="button"
                        >
                          <span>{post.course?.name ?? "전체"} · 조회 {post.view_count}</span>
                          {post.title}
                        </button>
                      ))
                    ) : (
                      <p>유사 글을 찾지 못했습니다. 직접 등록해도 좋아요.</p>
                    )}
                  </div>
                ) : null}

                {message ? <p className="mypage-message">{message}</p> : null}
                <div className="community-composer-actions">
                  {reviewMode ? (
                    <>
                      <button className="button button-outline button-md" onClick={() => setReviewMode(false)} type="button">
                        다시 수정
                      </button>
                      <button
                        className="button button-default button-md"
                        data-testid="community-compose-submit"
                        disabled={isPending}
                        onClick={submitPost}
                        type="button"
                      >
                        직접 등록
                        <Send size={16} aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <button
                      className="button button-default button-md"
                      data-testid="community-compose-review"
                      onClick={continueToReview}
                      type="button"
                    >
                      유사 글 먼저 보기
                      <Search size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PostRail({
  icon,
  posts,
  title,
  onSelect,
}: {
  icon: React.ReactNode;
  posts: CommunityPostRecord[];
  title: string;
  onSelect: (postId: string) => void;
}) {
  return (
    <section className="community-rail">
      <div className="community-section-heading">
        <h2>{title}</h2>
        {icon}
      </div>
      {posts.map((post) => (
        <button key={post.id} onClick={() => onSelect(post.id)} type="button">
          <span>{post.course?.name ?? "전체"}</span>
          {post.title}
        </button>
      ))}
    </section>
  );
}
