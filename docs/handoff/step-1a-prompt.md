0단계 DB 감사 결과를 바탕으로 PaceMate의 기존 schema drift를 정리하고,

학생 주간 로드맵 및 교수 학기 리포트의 기반 migration을 작성해줘.



이번 단계에서는:

\- migration SQL 파일 작성

\- 관련 TypeScript 타입 설계

\- 서버 서비스 인터페이스 설계

까지만 진행해.



중요:

\- 실제 Supabase DB에는 아직 적용하지 마.

\- Supabase MCP 쓰기 작업을 하지 마.

\- 기존 데이터를 삭제하지 마.

\- DROP TABLE, TRUNCATE, 기존 row 삭제 금지

\- commit, push 하지 마.

\- 새로운 패키지를 설치하지 마.

\- service role 키나 secret을 출력하지 마.

\- migration 파일 이름을 임의로 만들지 말고,

&#x20; Supabase CLI가 사용 가능하면

&#x20; `supabase migration new weekly\_roadmap\_foundation`

&#x20; 명령으로 migration 파일을 먼저 생성해.

\- CLI를 사용할 수 없다면 실행하지 말고 그 사실을 보고해.



0단계에서 확인된 실제 불일치:



1\. 코드가 student\_courses.current\_week를 사용하지만 실제 DB에 없음

2\. 코드가 student\_mission\_progress를 사용하지만 실제 DB에 테이블 없음

3\. student\_profiles.is\_onboarded가 실제 DB에 없음

4\. professor\_availability.specific\_date가 실제 DB에 없음

5\. chat\_sessions, escalations, counseling\_requests에 과목 연결이 없음

6\. 실제 DB와 schema.sql 사이 drift가 큼

7\. 현재 로그인은 Supabase Auth가 아니라 demo profile cookie 기반

8\. 기존 anon 정책이 지나치게 넓음



다음 아키텍처를 사용해줘.



1\. academic\_terms



필수 컬럼:

\- id uuid primary key

\- school\_id nullable FK

\- semester\_label text

\- starts\_on date

\- ends\_on date

\- timezone text default 'Asia/Seoul'

\- total\_weeks integer default 15

\- is\_active boolean

\- created\_at

\- updated\_at



unique:

\- school\_id + semester\_label



2\. course\_offerings



필수 컬럼:

\- id uuid primary key

\- course\_id FK

\- professor\_id FK

\- term\_id FK

\- section\_label nullable

\- starts\_on nullable

\- ends\_on nullable

\- created\_at

\- updated\_at



기본적으로 academic\_terms의 날짜를 사용하되,

과목별 시작일이 다른 경우 starts\_on/ends\_on으로 override할 수 있게 해.



3\. course\_weekly\_plans



필수 컬럼:

\- id uuid primary key

\- offering\_id FK

\- week\_number integer

\- title nullable

\- topic nullable

\- content nullable

\- learning\_objectives jsonb

\- preview\_guide jsonb

\- review\_guide jsonb

\- assignment\_json jsonb

\- source\_syllabus\_id nullable FK

\- source\_reference nullable

\- extraction\_confidence nullable

\- review\_required boolean

\- professor\_confirmed boolean

\- created\_at

\- updated\_at



unique:

\- offering\_id + week\_number



4\. student\_course\_progress



필수 컬럼:

\- id uuid primary key

\- student\_id FK

\- offering\_id FK

\- last\_completed\_week nullable

\- status

\- last\_activity\_at nullable

\- created\_at

\- updated\_at



중요:

\- calendarWeek를 이 테이블에서 수동 증가시키지 말 것

\- 공식 주차는 개강일과 현재 날짜로 계산

\- student\_courses.current\_week 컬럼은 새로 추가하지 말 것



unique:

\- student\_id + offering\_id



5\. student\_weekly\_progress



필수 컬럼:

\- id uuid primary key

\- student\_id FK

\- offering\_id FK

\- week\_number integer

\- progress\_status\_override nullable

\- difficulty\_level nullable, 1\~5

\- understanding\_level nullable, 1\~5

\- private\_note nullable

\- shared\_feedback nullable

\- share\_feedback\_with\_professor boolean default false

\- use\_private\_note\_for\_ai boolean default false

\- guide\_json jsonb nullable

\- guide\_version nullable

\- input\_hash nullable

\- generated\_at nullable

\- created\_at

\- updated\_at



progress\_status\_override 허용값:

\- not\_started

\- in\_progress

\- covered

\- needs\_review

\- skipped



null이면 날짜 기준 자동 진행 상태를 사용한다.



unique:

\- student\_id + offering\_id + week\_number



6\. 기존 테이블 보완



안전한 nullable 컬럼 또는 기본값으로 추가:



student\_profiles:

\- is\_onboarded boolean not null default false



professor\_availability:

\- specific\_date date nullable



student\_courses:

\- offering\_id uuid nullable FK



chat\_sessions:

\- offering\_id uuid nullable FK



escalations:

\- offering\_id uuid nullable FK



counseling\_requests:

\- offering\_id uuid nullable FK



기존 데이터에는 offering\_id를 임의 추론하여 강제로 넣지 말고 null로 유지해.



7\. 기존 코드 호환 계획



현재 존재하지 않는:

\- student\_courses.current\_week

\- student\_mission\_progress



를 새 migration에서 그대로 재현하지 마.



대신 다음 코드를 이후 1-C 단계에서 새 구조로 교체할 계획을 문서화해.



\- src/app/dashboard/page.tsx

\- src/components/roadmap/weekly-missions.tsx

\- src/services/ai-tutor.actions.ts



이번 단계에서는 앱 코드를 대규모 수정하지 말고,

호환 전환 계획만 작성해.



8\. demo auth 보안 방향



현재 demo 로그인 UI는 유지하되,

단순 profile ID 쿠키를 권한의 근거로 신뢰하지 않도록 설계해.



권장:

\- 서명된 httpOnly 세션 쿠키

\- SESSION\_SECRET 서버 환경변수

\- SameSite=Lax 또는 Strict

\- Secure는 production에서 활성화

\- 서버에서 세션 검증 후 profile id 확인

\- 민감한 신규 데이터는 client Supabase anon 호출 금지

\- server-only service/action을 통해서만 접근



주의:

\- 이번 단계에서는 실제 로그인 흐름을 전면 교체하지 마.

\- Supabase Auth 전환은 별도 후속 단계로 문서화

\- service\_role을 클라이언트에 절대 노출하지 말 것

\- server-side service\_role 사용이 필요하다면 최소 함수 범위와

&#x20; 세션 검증 요구사항을 명시할 것



9\. RLS 및 GRANT 설계



모든 신규 public 테이블:

\- RLS 활성화



원칙:

\- 신규 민감 테이블에 anon 직접 select/insert/update/delete 권한을 주지 말 것

\- 단순 USING(true), WITH CHECK(true) 금지

\- authenticated 전체 사용자에게 무조건 허용하는 정책 금지

\- private\_note가 교수 집계 또는 view에 포함되지 않도록 할 것

\- 학생별 원자료와 교수용 집계 데이터 접근을 분리할 것

\- 교수는 자신이 담당한 offering의 익명 집계만 볼 수 있게 설계할 것

\- 표본 5명 미만 집계는 리포트 계층에서 숨길 수 있게 설계할 것



현재 demo auth가 auth.uid()와 연결되지 않으므로:

\- 억지로 잘못된 auth.uid() 정책을 만들지 말 것

\- 현재 MVP에서는 신규 민감 테이블을 direct Data API로 노출하지 않고

&#x20; server-only access로 제한하는 방안을 우선 설계할 것

\- Supabase Auth 전환 후 적용할 정식 RLS 정책안도 별도로 제안할 것



10\. 기존 drift 복구



migration에는 다음을 명확히 구분해줘.



A. 기존 코드가 사용하지만 DB에 없는 컬럼 복구

B. 주간 로드맵 신규 구조

C. 질문/상담 offering 연결

D. 인덱스

E. RLS

F. GRANT/REVOKE

G. updated\_at trigger

H. rollback 주의사항



migration은 여러 번 실행해도 안전하도록 가능한 범위에서

IF NOT EXISTS 또는 존재 여부 검사를 사용해.



단, 잘못된 구조를 숨기기 위해 무조건 IF NOT EXISTS만 붙이지 말고

기존 컬럼 타입이 다를 때는 명확한 검증 블록이나 경고를 제공해.



11\. 타입과 서비스 인터페이스



다음 TypeScript 타입 초안을 생성해줘.



\- AcademicTerm

\- CourseOffering

\- CourseWeeklyPlan

\- StudentCourseProgress

\- StudentWeeklyProgress

\- WeeklyProgressStatus



서버 전용 서비스 인터페이스 초안:

\- getActiveAcademicTerm

\- getCourseOfferingForStudent

\- getWeeklyPlan

\- getStudentWeeklyProgress

\- saveStudentWeeklyProgress



아직 실제 DB가 적용되지 않았으므로

서비스가 런타임에서 새 테이블을 호출하도록 기존 화면에 연결하지 마.



12\. 문서



다음 문서를 생성해줘.



docs/architecture/weekly-roadmap-foundation.md



포함:

\- 최종 ER 구조

\- 기존 테이블과 새 테이블 관계

\- calendarWeek와 실제 진도의 차이

\- private\_note와 shared\_feedback의 차이

\- demo auth 임시 보안 방식

\- Supabase Auth 전환 시 변경점

\- migration 적용 순서

\- rollback 원칙

\- 1-C 코드 전환 대상



13\. 최종 검증



아직 실제 DB에는 적용하지 말고 다음만 검사해.



\- SQL 문법 검토

\- 중복 constraint 이름

\- FK 대상 존재 여부

\- index 중복

\- TypeScript typecheck

\- npm run lint

\- npm run build



개발 서버와 build를 동시에 실행하지 마.



최종 보고:

\- 생성한 migration 파일

\- 생성/수정한 TypeScript 파일

\- 생성한 문서

\- 실제 DB에는 아무 변경도 하지 않았다는 확인

\- migration 주요 SQL 요약

\- RLS/GRANT 요약

\- 기존 데이터 보존 방식

\- 내가 직접 검토해야 할 위험한 SQL

\- 다음 1-B 단계에서 실행할 정확한 절차

