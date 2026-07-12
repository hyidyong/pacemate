# 법학과 curriculum import 정확성 검토 (1-D-3B)

## source 범위

- 원본: `docs/reference/bluebooks/law/source.pdf` (PDF 18쪽)
- 구조화 근거: `src/data/bluebooks/law.json`
- page 매핑: `docs/architecture/bluebook-law-source-map.md`
- 지원 범위: 법학과만. 전자공학과와 다른 학과는 포함하지 않음
- `sourceAcademicYear`: `null`
- `publicationDate`: `null`
- `sourceVerified`: `false`
- import 상태: `draft_unresolved`

법학과 PDF의 인쇄 쪽수 7은 학년·학기별 과목, 8은 졸업요건·예외, 9~17은 진로별 과목 흐름의 근거로 사용했다. 발행연도나 판본은 확정하지 않았다.

## 생성 파일

- `src/data/curricula/law/2026.import.json`
- 실제 DB INSERT/UPDATE/DELETE, migration, seed, UI 변경 없음

## 변환 수치

| 항목 | 수 |
| --- | ---: |
| curriculumCourses | 46 |
| exact course match | 6 |
| unresolved course | 40 |
| curriculumRequirements | 3 |
| curriculumRequirementExceptions | 5 |
| courseEquivalencies | 0 |
| careerTracks | 11 |
| careerTrackCourses | 123 |
| unresolvedItems | 8 |

Exact match는 read-only DB의 법학과 catalog에서 과목명과 학과가 정확히 일치한 담보물권법, 상법총론, 회사법, 행정절차와행정구제, 민사소송법(1), 민사소송법(2)만 연결했다. 원본 PDF에 과목코드와 과목별 학점이 구조화되어 있지 않아 `sourceCourseCode`와 `credits`는 추측하지 않고 null로 유지했다.

## 졸업요건 변환

직접 구조화한 항목은 다음 3건이다.

1. 총 졸업학점 120학점 이상 (page 8)
2. 2024학년도 신입생부터 법학개론·대학생활과진로설계 전공필수 (page 8)
3. 2014학년도 신입학생부터 전공영어 1과목 또는 TOEIC 600점 이상 (page 8)

전공 최소학점, 교양 최소학점, 채플/P/F, 졸업논문·시험, 학교 공통 규칙은 원본에서 확정할 수 없어 requirement row를 발명하지 않고 unresolved로 기록했다. 입학연도 범위는 단일 curriculum version으로 합치지 않고 requirement/exception ruleDefinition에 보존했다.

예외 5건은 2023학년도까지 전공필수 미적용, 편입학생·복수전공·국제학생·외국대학 복수학위 이수학생의 외국어 요건 적용 제외다. 학생 assignment와 authoritative source가 필요한 예외는 `requiresManualReview=true`다.

## 진로 트랙 변환

기존 law.json/source map에 실제로 존재하는 11개 트랙만 변환했다. 로스쿨/변호사시험, 법무사, 공인노무사, 공인중개사, 감정평가사, 변리사, 검찰·마약수사직, 법원직, 등기사무직, 경찰직, 기타 공무원 트랙이다.

진로 과목은 졸업필수가 아니라 추천 순서로 저장하고 `isRequired=false`로 유지했다. 진로표의 `형사소송법`은 curriculum의 `형사소송법(1)/(2)`와 정확히 일치하지 않아 `curriculumCourseLocalKey=null`로 두었고, 어느 과목인지 추정하지 않았다.

## unresolved 및 blocksImport

`unresolvedItems`는 다음 8개 범주다.

- DB courses exact match가 없는 40개 과목: nullable courseId로 import 가능하나 seed 전 catalog 확인 필요
- 과목별 학점 불명: 졸업학점 계산 seed를 막음
- 입학연도 적용 범위 불명: published version 생성을 막음
- 대부분 과목의 필수 여부 불명: 명시된 2건 외 자동 승격 금지
- 외국어 요건의 학생 assignment 적용 source 불명: 자동 판정을 막음
- 전공 최소학점·채플/PF·졸업논문/시험 불명: 졸업요건 확정을 막음
- 진로표 과목 연결 불명: 추천 연결은 보류 가능하나 prerequisite 생성 금지
- 학교 공통 졸업요건과의 충돌 가능성: published seed를 막음

`blocksImport=true`인 항목은 학점, admission scope, language scope, 졸업요건/학교 공통 규칙이다. course match와 진로 연결은 schema가 unresolved를 보존할 수 있으므로 이 파일 생성 자체는 막지 않지만, published seed 전에는 해결해야 한다.

## 검증 상태와 seed disposition

- `verified`: 0건. PDF 판본·발행연도와 과목별 학점이 확인되지 않았다.
- `partially_verified`: 6개 exact DB course match, page 8의 명시 요건 3건, 예외 5건, page 9~17의 진로 트랙 11건은 원문 근거가 있으나 전체 import는 미확정이다.
- `unresolved`: 40개 과목 매칭과 학점·입학연도·외국어 적용 범위·학교 공통 요건 및 일부 진로 과목 연결.
- `excluded`: 0건. PDF의 학년·학기 과목을 임의로 제외하지 않았다.
- `seedNow`: 0건. 확정 published seed는 만들 수 없다.
- `seedAsDraft`: 구조 검토용 draft row로만 보존 가능하다. 이 단계에서는 seed SQL을 생성하거나 실행하지 않았다.
- `holdForConfirmation`: published activation과 졸업학점 계산은 담당자·공식 catalog 확인 전 보류한다.
- `blocksDraftSeed=false`, `blocksActivation=true`, `blocksGraduationCalculation=true`를 JSON metadata에 함께 기록했다.

`verificationStatus=partially_verified`는 일부 근거가 교차 확인되었다는 뜻이며 교수·학과 승인 또는 최신성 확인을 의미하지 않는다.

## seed 전 반드시 확인할 항목

1. 46개 과목의 공식 과목코드·학점·학과를 `courses`와 exact match
2. 6개 연결 courseId가 계속 존재하는지와 법학과 소속 확인
3. 2024/2014 적용 범위와 입학연도별 curriculum version 결정
4. 전공필수·전공선택·교양 구분을 공식 교육과정으로 확인
5. 전공 최소학점, 교양, 채플/PF, 졸업논문·시험 및 학교 공통 규칙 확인
6. 편입·복수전공·국제학생·복수학위 예외의 authoritative student source 확인
7. 진로 추천 과목 중 null localKey 항목의 공식 과목 연결 확인
8. 담당자 승인 후에만 `sourceVerified`와 published 상태 전환

## 검토 상태와 다음 단계

- JSON.parse: 성공
- migration check 값: `status`, `requirementType`, `exceptionType`, 추천 학년·학기 범위를 migration 허용값에 맞춤
- localKey 중복: 없음
- source page: PDF 인쇄 쪽수 7~17 범위 내
- publicationDate 추측: 없음
- DB/migration/seed 변경: 없음

1-D-3B는 **검토 진행 가능**하다. 다만 이 import는 draft/unresolved 상태이며, `blocksImport` 항목이 해결되고 담당자 검토가 끝나기 전에는 법학과 curriculum seed나 published version을 만들 수 없다. 1-D-3C seed SQL 작성·실행은 현재 범위에서 진행하지 않는다.
