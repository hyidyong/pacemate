# pacemate
# PaceMate

> 학생에게는 맞춤형 학업 로드맵을, 교수에게는 행정업무 자동화를 제공하는 역할 기반 AI 학업 어시스턴트 플랫폼

🔗 **[바로가기 →](https://pacemate-tau.vercel.app/dashboard)**

---

## 💡 프로젝트를 만든 이유 & 해결하려는 문제

**만든 이유**

대학 입학이나 전공 진입 초기에는 무엇부터 준비해야 하는지, 어떤 순서로 학업을 쌓아가야 하는지에 대한 정보가 선배·동기 사이에 비공식적으로만 흩어져 있습니다.
이 정보 격차를 줄이고, 학생 개개인의 상황에 맞는 학업 로드맵을 자동으로 제시해주는 서비스를 만들고자 시작했습니다.

**해결하려는 문제**

- 🎓 **학생**: 전공 적응 과정에서 "지금 무엇을 해야 하는지"를 스스로 판단하기 어렵고, 학교 차원의 개인화된 가이드는 거의 제공되지 않습니다.
- 🧑‍🏫 **교수**: 학기 중 학생 메일 응대, 상담 요청 처리 같은 자잘한 행정 업무가 누적되어 본연의 연구·강의에 쏟을 시간을 뺏기는 경우가 많습니다.

PaceMate는 로그인 직후 1회성 온보딩으로 학생의 상황을 파악해 맞춤형 로드맵을 제시하고, 학생·교수·관리자 각자에게 필요한 정보와 업무만 보여주는 역할 기반 대시보드로 이 문제를 해결합니다.

---

## 🚀 주요 기능

**역할 기반(RBAC) 대시보드**
로그인 시 이메일·비밀번호 인증 후 DB(profiles)에서 사용자 Role(학생/교수/관리자)을 조회하여, 권한에 맞는 대시보드와 서비스로 자동 연결됩니다. 불필요한 메뉴 노출 없이 역할별로 꼭 필요한 화면만 제공합니다.

**맞춤형 로드맵 온보딩**
학생은 최초 로그인 시 한 번의 온보딩 과정을 거치며, 이때 입력된 정보를 바탕으로 개인화된 학업 로드맵과 다음 할 일(Next Action)이 대시보드에 노출됩니다.

**교수 행정업무 자동화**
학생 메일 응대, 상담 요청 접수·관리 등 학기 중 반복적으로 발생하는 자잘한 행정 업무를 교수 대시보드에서 한 번에 처리할 수 있도록 자동화합니다. 개별적으로 흩어져 있던 요청을 한 곳에서 관리해 응대 누락을 줄이고 처리 시간을 단축합니다.

---

## 🛠️ 기술 스택

| 구분 | 사용 기술 |
|---|---|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix UI), Framer Motion, Zustand |
| **Backend / DB** | Supabase (PostgreSQL, Auth, RBAC) |
| **AI Tool Integration** | *[확인 필요 — 개발 보조 도구(OpenAI Codex)인지, 서비스 내 AI API 호출 기능인지 명시. package.json 기준 별도 AI API 의존성은 미확인]* |

---

## 📦 설치 및 실행 방법 (Installation & Running)

```bash
# 1. 저장소 클론
git clone https://github.com/hyidyong/pacemate.git

# 2. 프로젝트 디렉토리 이동
cd pacemate

# 3. 의존성 패키지 설치
npm install

# 4. 환경 변수 설정 (.env.local 파일 생성 후 아래 값 입력)
# NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key

# 5. 개발 서버 실행
npm run dev
```