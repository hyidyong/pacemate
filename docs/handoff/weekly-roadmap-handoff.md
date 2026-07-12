\# PaceMate 주간 로드맵·교수 리포트 인수인계



\## 현재 완료된 작업



\- 학생 대시보드 반응형 탭 및 학사일정

\- 학생 알림 가로 슬라이더

\- 교수 모바일 햄버거 메뉴 통합

\- 교수 홈 상담 요청 중복 제거

\- 교수 홈 시간표·학사일정·포털 바로가기

\- 교수 포털 모바일 아이콘 + 한글 이름

\- 0단계 코드 및 Supabase 실제 DB 감사



\## DB 변경 여부



0단계에서는 Supabase 실제 DB를 읽기 전용으로만 조사했다.



\- DB 변경 없음

\- migration 적용 없음

\- commit/push 없음

\- 실제 데이터 수정 없음



\## 0단계 핵심 감사 결과



\### 코드와 실제 DB 불일치



1\. 코드가 `student\_courses.current\_week`를 사용하지만 실제 DB에는 컬럼이 없음

2\. 코드가 `student\_mission\_progress`를 사용하지만 실제 DB에는 테이블이 없음

3\. `student\_profiles.is\_onboarded`가 실제 DB에 없음

4\. `professor\_availability.specific\_date`가 실제 DB에 없음

5\. `chat\_sessions`, `escalations`, `counseling\_requests`에 과목 또는 개설 강좌 연결이 없음

6\. `schema.sql`과 실제 Supabase DB 사이에 큰 drift가 있음

7\. 실제 migration 파일이 없고 `schema.sql` 단일 파일 중심

8\. 현재 인증은 Supabase Auth가 아니라 demo profile cookie 기반



\### 보안 문제



\- anon 정책이 넓게 설정되어 있음

\- student\_profiles와 student\_courses의 개인 데이터가 과도하게 열릴 가능성

\- counseling\_requests anon select가 넓음

\- 단순 profile id 쿠키를 사용자 인증 근거로 사용

\- 교수 리포트에 더미 데이터가 섞일 위험

\- 학생 개인 메모와 학습 상태 저장 전 RLS 및 서버 접근 구조 정리가 필요



\## 확정한 아키텍처 방향



1\. `student\_courses.current\_week`는 추가하지 않는다.

2\. 공식 수업 주차는 개강일과 현재 날짜로 계산한다.

3\. 존재하지 않는 `student\_mission\_progress`를 만들지 않는다.

4\. 학생 주차 기록은 `student\_weekly\_progress`로 통합한다.

5\. 다음 테이블 구조를 사용한다.



\- academic\_terms

\- course\_offerings

\- course\_weekly\_plans

\- student\_course\_progress

\- student\_weekly\_progress



6\. chat\_sessions, escalations, counseling\_requests에는 nullable `offering\_id`를 추가한다.

7\. 기존 데이터의 offering\_id는 강제로 추정하지 않고 null로 보존한다.

8\. private\_note는 학생만 열람한다.

9\. 교수에게는 담당 강좌의 익명 집계만 제공한다.

10\. 현재 demo 로그인 UI는 유지하되 서명된 서버 세션으로 보강한다.

11\. 실제 공개 전에는 Supabase Auth 전환이 필요하다.



\## 다음 작업



다음 작업은 `1-A 단계`이다.



1-A에서는:



\- migration SQL 파일 작성

\- TypeScript 타입 작성

\- 서버 서비스 인터페이스 설계

\- architecture 문서 작성



까지만 한다.



아직 실제 Supabase DB에는 적용하지 않는다.



\## 1-A 작업 시 금지사항



\- Supabase DB 쓰기 금지

\- migration 실제 적용 금지

\- DROP TABLE 금지

\- TRUNCATE 금지

\- 기존 데이터 DELETE 금지

\- anon에게 민감 테이블 전체 권한 부여 금지

\- USING(true), WITH CHECK(true) 정책 금지

\- service role 키 클라이언트 노출 금지

\- commit/push 자동 실행 금지



\## 1-A 이후



1\. migration SQL 사람이 검토

2\. Supabase MCP 또는 SQL Editor로 직접 적용

3\. 실제 DB 구조 재검증


## 1-B-2 실제 DB 적용 완료

- 적용 migration: `supabase/migrations/20260712000000_weekly_roadmap_foundation.sql`
- 적용 날짜: 2026-07-12 (Asia/Seoul)
- 대상 프로젝트: Supabase `pacemate` (앱 환경의 project ref/URL과 일치)
- 신규 테이블: `academic_terms`, `course_offerings`, `course_weekly_plans`, `student_course_progress`, `student_weekly_progress`
- 추가 컬럼: `student_profiles.is_onboarded`, `professor_availability.specific_date`, `student_courses.offering_id`, `chat_sessions.offering_id`, `escalations.offering_id`, `counseling_requests.offering_id`
- 기존 row count 보존: 적용 전후 동일 (`student_profiles 11`, `professor_availability 9`, `student_courses 6`, `chat_sessions 0`, `escalations 0`, `counseling_requests 3`)
- RLS: 신규 테이블 5개 모두 활성화
- 권한: `public`, `anon`, `authenticated` 직접 권한 없음
- 정책: 신규 테이블 정책 없음; `auth.uid()` 정책 없음
- 새 `SECURITY DEFINER` 함수 없음
- Security Advisor: 기존 `professor_admin_tasks` permissive policy 경고 유지; 신규 security warning 없음. 신규 테이블의 RLS-no-policy INFO는 의도한 server-only 상태
- Performance Advisor: progress offering FK 미인덱스 INFO가 확인되어 후속 최적화 대상으로 기록
- 다음 단계: 1-C 서버 서비스 및 앱 코드 전환 (이번 단계에서는 진행하지 않음)

4\. 기존 코드를 새 테이블 구조로 전환


## 1-B-3 migration history 동기화 완료

- 버전: `20260712000000`
- `npx --yes supabase@2.109.1 migration list --linked` 확인 결과 local/remote history 일치
- `20260712000000`: local applied, remote applied
- migration repair로 remote history에 applied 처리 완료
- foundation migration SQL 재실행 없음
- 이번 확인 단계에서 schema, 기존 데이터, 앱 코드는 추가 변경 없음
- 다음 단계: 1-C-0 demo session 및 server-only DB access 기반 구현


## 1-C-0 진행 결과

- signed demo session 구현 완료 (`pacemate_session`, HMAC-SHA256, httpOnly, SameSite=Lax, production Secure, 8시간 TTL)
- 기존 legacy profile/role cookie는 로그아웃·호환 fallback 용도로만 유지
- `PACEMATE_SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` 변수명을 `.env.local.example`에 문서화
- server-only Supabase admin client 추가
- 주간 로드맵 read service 4개 추가: active term, student offerings, weekly plan, student weekly progress
- 모든 read 함수는 세션·role·student ownership 검증 수행
- `offering_id` NULL 상태에서 자동 생성/backfill하지 않음
- save/private note/shared feedback/AI guide/기존 AI 미션 전환/UI 연결은 수행하지 않음
- 실제 DB/schema/data/migration history 추가 변경 없음
- 다음 단계: 1-C-1 초기 term/offering 데이터 및 read 연결 검토
