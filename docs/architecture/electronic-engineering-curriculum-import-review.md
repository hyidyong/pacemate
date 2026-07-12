# 전자공학과 curriculum import 이미지 누락 보정 검토 (1-D-4A-1)

## 원본 범위와 교차검증

- 원본: `docs/reference/bluebooks/electronic-engineering/source.pdf` (PDF 38쪽)
- 원본 우선순위: 전자공학과 Bluebook PDF > 현재 curriculum/graduation schema > read-only DB catalog
- 지원 범위: 전자공학과만. 법학과 파일, 다른 학과, seed SQL, migration, 서비스·UI는 변경하지 않음
- `sourceAcademicYear`: `2026`
- `publicationDate`: `null` (정확한 발행일 불명)
- `sourceVerified`: `false`
- `schoolId`: 계명대학교 row를 확인해 연결
- `departmentId`: read-only `departments`에 전자공학과 row가 없어 `null`

PDF page 4(인쇄 page 3)의 이미지형 `전자공학과 교육과정 이수체계도`에서 과목명을 직접 확인했다. 텍스트형 과목표는 없지만 이미지 도식에 47개 배치(중복 표기 6개)를 확인하여 41개 고유 과목을 보존했다. 공식 코드·과목별 학점·정확한 학기는 도식에 없으며, page 3의 진로는 진출 분야와 취업처 설명만 있어 과목 추천 트랙으로 변환하지 않았다.

## 변환 수치

| 항목 | 수 |
| --- | ---: |
| `curriculumCourses` (고유 과목) | 41 |
| 과목 `verified` / `partially_verified` / `unresolved` / `excluded` | 0 / 41 / 0 / 0 |
| exact DB course match | 0 |
| 과목 학점 확인 / 미확인 | 0 / 41 |
| 학년 확인 / 미확인 | 41 / 0 |
| 정확한 학기 확인 / 미확인 | 0 / 41 |
| 필수·선택 확인 / 미확인 | 0 / 41 |
| 이미지 도식 배치 / 중복 표기 | 47 / 6 |
| 커리큘럼 흐름 관계 | 3개 학년 전환 화살표(개별 과목 쌍 0) |
| `curriculumRequirements` | 22 |
| `curriculumRequirementExceptions` | 8 |
| `courseEquivalencies` | 0 |
| `careerTracks` / `careerTrackCourses` | 0 / 0 |
| `unresolvedItems` | 10 |

졸업요건에 포함된 수치형 학점·이수 제한은 18건(최소학점 필드 15건, 규칙 payload의 제한·P/F 수치 3건)을 원문 페이지에서 확인해 별도 requirement로 보존했다. 이는 과목별 학점 확인 수가 아니다.

요건·예외 항목 상태를 합산하면 `verified=19`, `partially_verified=9`, `unresolved=2`, `excluded=0`이다. 과목명·학년은 이미지에서 확인되어 `partially_verified`로 두었고, courseId 미매칭만으로 과목을 unresolved 처리하지 않았다.

## 구조화한 규칙

- 2024학년도 이후: 총 120학점, 공통교양 12학점, 균형·일반교양 18학점 이상, 전자공학과 제1전공 69학점, 타전공 Micro Degree 1개, 학기 18·학년 34학점 제한
- 2023학년도 이전: 총 130학점, 입학연도 구간별 공통교양·균형교양, 전공 및 제1전공·타전공 합계 기준, 학기 20·학년 36학점 제한
- 채플/P/F, 전공필수 전체 이수 원칙, 교직 설치 목록, 졸업논문·시험 여부는 원문 근거를 별도 requirement 또는 unresolved로 보존했다.
- 편입·전과·재입학·복수전공·부전공·학과 통합/분리·국제학생 예외는 일반 규칙으로 기록하되 전자공학과 적용은 수동 확인 대상으로 두었다.

## 검증 상태와 seed 범위

- `seed_now`: 0
- `seed_as_draft`: 이미지 확인 과목 41개와 원문 수치형 규칙의 구조 보존이 가능하다. 실제 seed SQL은 생성하지 않았다.
- `hold_for_confirmation`: 전체 curriculum version 활성화, 졸업 계산, 전공필수·교직·졸업논문/시험, 입학연도별 version 확정
- `blocksDraftSeed=false`: 과목명·학년이 확보되어 import JSON draft seed 데이터는 구성 가능하다. 다만 실제 DB draft row 입력에는 전자공학과 department FK 확인이 선행되어야 한다.
- `blocksActivation=true`: 과목 catalog, admission scope, 학과 요건, 학적 예외가 미확정이다.
- `blocksGraduationCalculation=true`: 과목 학점·정확한 학기·전공필수 목록·학과별 졸업요건이 없다.

## 1-D-4B 전 정확성 검토 항목

1. 전자공학과 `departments` row 및 공식 식별자 확인
2. EDWARD 연도별 전공 교육과정표에서 과목명·코드·학점·학년·학기·이수구분 확보
3. 확보한 과목만 `courses`와 이름 또는 코드 exact match
4. 2024학년도 이후와 2023학년도 이전 입학연도 version을 분리
5. 전공필수·교직 설치 여부·졸업논문/시험·Micro Degree 적용 대상 확인
6. 편입·전과·재입학 및 학교 공통 내규의 학생 속성 매핑 확인

1-D-4B 정확성 검토는 **진행 가능**하다. 다만 현재 상태에서 seed SQL 생성은 **불가**하며, 위 확인과 담당자 검토가 끝난 뒤 별도 단계에서만 검토한다.

실제 DB 변경, migration 변경, seed 생성·실행, 법학과 파일 수정은 없었다.
