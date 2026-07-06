export type CommunityCategory = "all" | "question" | "study" | "review" | "notice";

export type CommunityPost = {
  id: string;
  category: Exclude<CommunityCategory, "all">;
  courseName: string;
  title: string;
  content: string;
  author: string;
  createdAt: string;
  likes: number;
  scraps: number;
  comments: number;
  tags: string[];
  officialHint?: string;
};

export const communityCategories: Array<{
  id: CommunityCategory;
  label: string;
  description: string;
}> = [
  { id: "all", label: "전체", description: "질문과 정보글 전체" },
  { id: "question", label: "질문", description: "수업/과제/시험 질문" },
  { id: "study", label: "스터디", description: "공부 모임과 자료 공유" },
  { id: "review", label: "후기", description: "수강 경험과 팁" },
  { id: "notice", label: "공지", description: "조교/관리자 안내" },
];

export const communityPosts: CommunityPost[] = [
  {
    id: "post-civil-proof",
    category: "question",
    courseName: "민사소송법(2)",
    title: "증명책임 파트는 어떤 순서로 정리하면 좋을까요?",
    content:
      "자유심증주의까지는 따라가겠는데 증명책임 분배, 전환, 완화가 사례에서 섞이면 헷갈려요. 중간 이후 복습 순서를 추천받고 싶습니다.",
    author: "법학과 4학년",
    createdAt: "방금 전",
    likes: 12,
    scraps: 8,
    comments: 4,
    tags: ["증거", "증명책임", "중간이후"],
    officialHint: "강의계획서 10주차 자유심증주의와 증명책임 파트와 연결됩니다.",
  },
  {
    id: "post-civil-study",
    category: "study",
    courseName: "민법사례연습",
    title: "목요일 저녁 사례 목차 스터디 2명 더 구해요",
    content:
      "20분 안에 목차 세우고 서로 빠진 쟁점만 체크하는 방식으로 진행하려고 합니다. 민소법 듣는 분이면 더 좋아요.",
    author: "편입생 A",
    createdAt: "12분 전",
    likes: 6,
    scraps: 11,
    comments: 7,
    tags: ["스터디", "사례형", "목차"],
  },
  {
    id: "post-commercial-review",
    category: "review",
    courseName: "상법총론",
    title: "상법총론은 민법 비교표 만들면 훨씬 편합니다",
    content:
      "상인/상행위 정의를 먼저 외우고 민법 법률행위와 다른 부분을 표로 정리하니 시험 직전에 보기 좋았습니다.",
    author: "졸업예정자",
    createdAt: "1시간 전",
    likes: 25,
    scraps: 19,
    comments: 3,
    tags: ["수강후기", "상법", "비교표"],
  },
  {
    id: "post-writing-notice",
    category: "notice",
    courseName: "법문서작성",
    title: "법문서작성 초안 제출 전 체크리스트",
    content:
      "당사자 표시, 날짜, 청구취지, 증거목록 순서로 확인하세요. 제출 전 파일명에는 이름과 학번을 포함해야 합니다.",
    author: "조교",
    createdAt: "오늘 오전",
    likes: 18,
    scraps: 22,
    comments: 2,
    tags: ["공지", "과제", "체크리스트"],
    officialHint: "조교 공지로 등록된 글입니다.",
  },
];
