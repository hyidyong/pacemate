# Demo session and server-only roadmap access

## 1-C-0 범위

이번 단계는 기존 demo cookie 기반 인증을 서명된 서버 세션으로 보강하고, 주간 로드맵 foundation 테이블을 읽기 전용으로 조회하는 server-only 경계를 마련한다. 화면 UI, 기존 AI 미션 코드, progress 저장, offering 생성/backfill, Supabase Auth 전환은 다음 단계로 미룬다.

## 서명된 demo session

세션 cookie 이름은 `pacemate_session`이며 payload에는 `profileId`, `role`, `issuedAt`, `expiresAt`만 포함한다. payload와 HMAC-SHA256 서명을 base64url로 저장하고, 검증 시 constant-time 비교와 만료·미래 발급 시각 검사를 수행한다.

- cookie: `httpOnly`, `SameSite=Lax`, `Path=/`
- production: `Secure=true`
- TTL: 8시간
- secret: `PACEMATE_SESSION_SECRET` (최소 32 bytes, `NEXT_PUBLIC_` 금지)
- 만료·위조·형식 오류: 유효하지 않은 세션으로 처리
- 로그아웃: 서명 세션과 legacy `pacemate_profile_id`/`pacemate_role` 모두 삭제

기존 profile cookie는 이미 로그인한 demo 사용자의 호환을 위해 profile 조회에서만 fallback으로 읽는다. 새 민감 데이터 서비스는 legacy cookie를 사용하지 않고 서명 세션을 반드시 검증한다. password는 현재 demo provider가 identifier 기반으로 조회하는 기존 제한이 남아 있으며, 정식 password 인증과 Supabase Auth 전환은 별도 단계다.

## Server-only Supabase client

`src/lib/supabase/admin.ts`는 `SUPABASE_SERVICE_ROLE_KEY`를 읽어 service-role client를 생성한다. 이 모듈은 server action/server service에서만 import하며 client component로 가져오지 않는다. secret은 `.env.local`에 직접 설정해야 하고 `.env.local.example`에는 변수명과 설명만 둔다. service-role key는 브라우저 bundle, 로그, 응답 payload에 포함하지 않는다.

현재 foundation 테이블은 RLS가 켜져 있고 `public`/`anon`/`authenticated` grant가 없으므로 이 server-only 경계가 필요하다. service-role client 사용 범위는 주간 로드맵의 read 함수로 제한한다.

## Read service 계약

`src/services/weekly-roadmap.server.ts`가 제공하는 함수는 모두 `requireDemoSession()`을 먼저 실행한다.

- `getActiveAcademicTermForSession()`
- `getStudentCourseOfferingsForSession()`
- `getCourseWeeklyPlanForSession(offeringId, weekNumber)`
- `getStudentWeeklyProgressForSession(offeringId, weekNumber)`

학생 전용 함수는 role이 `student`인지 확인하고, offering 조회 전에 `student_courses.student_id = session.profileId AND offering_id = requestedOfferingId`를 검증한다. `studentId`는 외부 인자로 받지 않는다. offering이 NULL인 기존 enrollment는 빈 결과로 처리하며 자동 생성·추정·backfill하지 않는다.

읽기 오류는 `unauthenticated`, `wrong_role`, `offering_not_assigned`, `database_configuration_missing`, `database_read_failed`로 분류한다. 오류 메시지에는 secret, SQL, stack trace, 다른 학생의 식별자를 포함하지 않는다.

`saveStudentWeeklyProgress`, private note 저장, shared feedback 저장, AI guide 저장은 1-C-0에서 구현하지 않는다.

## 현재 운영 제한

- `.env.local`에 `PACEMATE_SESSION_SECRET` 또는 `SUPABASE_SERVICE_ROLE_KEY`가 없으면 해당 경계는 명확한 설정 오류를 반환한다.
- 현재 dashboard와 roadmap 화면은 아직 새 read service를 호출하지 않는다.
- `student_courses.offering_id`가 모두 NULL이므로 offering 기반 결과는 아직 비어 있다.
- Supabase Auth 전환 전에는 demo session이 임시 인증 경계이며, 정식 운영 전 password 검증과 Auth/RLS 정책 전환이 필요하다.

## 다음 단계

1-C-1에서 실제 academic term/course offering 초기 데이터와 화면 read 연결을 별도 승인 후 진행한다. 그 전까지는 기존 AI 미션 로직을 새 테이블로 전환하지 않는다.
