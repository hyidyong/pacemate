# 블루북 교육과정 데이터 import 가이드 (1-D-1 handoff)

## 목적과 금지 범위

이 문서는 법학과와 전자공학과 블루북을 공통 교육과정 schema로 옮길 때의 검토 규칙이다. 이 단계에서는 실제 DB, migration, seed, 기존 `courses`·학생 row, UI·서비스 코드를 변경하지 않았다.

승인되지 않은 bluebook draft를 학생에게 노출하지 않는다. 블루북은 전공 로드맵·졸업요건·진로 추천의 근거로만 사용하며, 특정 학기의 실제 개설강좌 목록으로 취급하지 않는다.

## 원본 자료

| 학과 | 원본 | 현재 정규화 자료 | 상태 |
| --- | --- | --- | --- |
| 법학과 | `docs/reference/bluebooks/law/source.pdf` | `src/data/bluebooks/law.json`, `docs/architecture/bluebook-law-source-map.md` | 구조화 초안 존재. `sourceEdition=null` 유지 |
| 전자공학과 | `docs/reference/bluebooks/electronic-engineering/source.pdf` | 없음 | 38쪽 PDF 확인. `source_academic_year=2026`, `publication_date=null`; 공통 JSON 정규화 전 검토 필요 |

법학 PDF는 18쪽이며 PDF metadata의 생성일이 있어도 공식 발행연도로 확정하지 않는다. 전자공학 PDF는 38쪽이며 source academic year만 2026으로 기록하고, 정확한 publication date는 null로 둔다. 파일 metadata 시각을 curriculum edition으로 사용하지 않는다. 두 자료 모두 학교·학과 담당자의 최신성 확인 전에는 `published` version으로 취급하지 않는다.

## 법학과에서 확인 가능한 범위

기존 `law.json`과 source map을 기준으로 다음만 import 후보로 본다.

- 학년·학기별 전공 과목 목록
- 명시된 최소 졸업학점과 외국어 요건
- 입학연도·편입생·복수전공 등 원문 예외
- 로스쿨/변호사시험, 법무사, 공인노무사, 공인중개사, 감정평가사, 변리사, 검찰·법원·경찰 등 진로 track
- 진로별 학년 순서와 근거 page

기존 source map의 page 근거(교육과정 7쪽, 졸업요건 8쪽, 진로 9~17쪽)를 `source_page`로 보존한다. 진로 track의 학년 순서는 `recommended_sequence`로만 저장하고, 개별 과목의 법적 선수과목은 생성하지 않는다.

## 전자공학과 import 준비

전자공학과는 원본 PDF만 확인된 상태다. 다음 항목을 원문 page별로 추출·검토한 뒤에만 JSON과 DB 후보를 만든다.

1. 교육과정 적용 입학연도와 개정판 식별자
2. 학년·학기별 과목명, 과목코드, 학점, 전공필수/선택 표기
3. 총 졸업학점, 전공 최소학점, 공통·교양 요건
4. 편입·복수전공·부전공·특정 입학연도 예외
5. 영어·졸업시험·P/F·캡스톤 등 비과목 요건
6. 진로 track과 과목 순서가 실제로 명시되어 있는지

PDF에 없는 과목 코드, 선수과목, 학점, 예외를 보완하지 않는다. 추출이 불명확한 page는 `unresolved`로 기록한다.

## 공통 import pipeline

### 1. source manifest 작성

학과, 원본 경로, page 수, source edition, 추출일, 검토자, content hash를 기록한다. 발행연도를 모르면 null이다.

### 2. 원문 항목 정규화

다음 공통 JSON 개념으로 변환한다.

- `departmentCode`, `departmentName`, `universityName`
- `sourceFile`, `sourceEdition`
- `curriculum[]`: grade, semester, course name, source page, requirement status
- `graduationRequirements[]`: rule type, rule definition, source page, applicability
- `exceptions[]`: admission year/student type scope, effect, source page
- `careerTracks[]`: id, name, category, course sequence, source pages
- `warnings[]`, `unresolved[]`

공통 구조에 없는 학과 특화 내용은 JSONB의 `metadata` 후보로 두되, 먼저 공통 컬럼으로 표현 가능한지 검토한다. 임의의 명칭을 새로 만들지 않는다.

### 3. `courses` 매칭

블루북 과목을 실제 `courses`와 연결할 때 다음 순서로 확인한다.

1. 원문 course code가 있고 `courses.code`와 학과가 일치하는지 확인
2. code가 없거나 충돌하면 department, 원문명, 학점, 설명을 함께 비교
3. 동명이인·유사명·과목번호 변경은 자동 연결하지 않음
4. 공식 equivalency가 확인된 경우에만 `course_equivalencies` 후보 작성
5. unresolved 매칭은 `course_id=null`로 보류하고 `courses` row를 새로 만들지 않음

블루북 source와 실제 catalog 매칭 결과는 별도 검토 자료로 보존한다. source JSON 원문을 매칭 결과로 덮어쓰지 않는다.

### 4. curriculum version 생성 후보

검토가 끝난 뒤에만 `curriculum_versions` 후보를 만든다. version은 학과·입학연도·원본 edition 단위로 나누며, 서로 겹치는 published 적용 범위를 허용하지 않는다. `draft`에서 `published`로 바꾸는 것은 학과 담당자의 승인 후 별도 절차다.

### 5. requirements와 exceptions 분리

총학점, 전공 최소학점, 필수 과목, 외국어, 졸업시험, P/F, 캡스톤 등은 `curriculum_requirements`로 저장한다. 편입생·복수전공생·부전공생·입학연도 차이는 `curriculum_requirement_exceptions`로 저장한다. 예외를 requirement JSON 안에 중복 복사하지 않는다.

### 6. career track 연결

진로 이름·category는 `career_tracks`, track별 권장 과목·학년 순서는 `career_track_courses`에 저장한다. `recommended_sequence`는 prerequisite가 아니며, 학생에게 “추천 순서”로만 표시한다. 시험 일정·합격요건은 변경 가능하므로 별도 최신성 warning을 유지한다.

## 데이터 품질 체크리스트

- source file과 page가 존재하는가
- sourceEdition이 근거 없이 채워지지 않았는가
- curriculum version의 학교·학과 FK가 실제 row와 일치하는가
- 같은 version의 course row가 중복되지 않는가
- grade/semester가 원문에 없는 경우 null 또는 unresolved인가
- 전공필수·전공선택을 원문 표기 없이 추론하지 않았는가
- 총학점·언어·졸업시험 수치가 source page와 연결되는가
- 입학연도·학생 유형 예외가 적용 범위와 함께 기록되는가
- course 매칭이 code/학과/학점/명칭 검토를 통과했는가
- 진로 순서를 prerequisite로 잘못 변환하지 않았는가
- 학생 개인정보나 UUID가 source JSON·문서에 들어가지 않았는가
- warnings와 unresolved가 비어 있지 않은데 published 처리하지 않았는가

## 현재 unresolved 목록

1. 전자공학과 PDF의 page별 과목·졸업요건 구조화
2. 법학과의 공식 edition 식별 및 전자공학과 publication date 확인(전자공학 source academic year는 2026으로 고정)
3. 실제 `courses` catalog와 블루북 과목의 exact match
4. 학생 입학연도와 편입·복수전공·부전공 authoritative source
5. 공식 성적·편입 인정자료의 제공 주체와 검증 절차
6. 졸업시험·언어·P/F·캡스톤의 최신 적용 여부
7. 진로 시험 정보의 최신성 및 현행 공고 확인

## 다음 단계 handoff

- `1-D-2`: 이 문서와 `curriculum-graduation-schema.md`를 검토한 뒤에만 migration 초안을 작성한다. 아직 migration 파일을 만들거나 적용하지 않는다.
- `1-D-3`: 법학 JSON을 공통 schema로 변환하고 course match review를 만든다.
- `1-D-4`: 전자공학과 PDF를 같은 schema로 변환한다.
- `1-D-5`: 담당자 승인 후에만 seed와 FK/count 검증을 수행한다.
- `1-D-6` 이후: curriculum resolution, 과목 선택, 졸업 계산을 server-only 서비스로 구현한다.

현재 `1-D-2`는 **설계 검토 후 진행 가능**하지만, 실제 migration·DB 입력은 source edition과 course matching이 확정될 때까지 보류한다. 이 문서 단계에서 seed, UI, 서비스 코드, 기존 DB row를 만들거나 변경하지 않는다.
