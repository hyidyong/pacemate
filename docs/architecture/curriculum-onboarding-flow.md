# 교육과정 기반 학생 onboarding·졸업요건 흐름 (1-D-1)

## 목표

학생이 학교·학과·입학연도·학생 유형을 선택하면 서버가 적용 가능한 `curriculum_version`을 결정하고, 해당 교육과정의 과목과 졸업요건을 반환한다. 학생의 과목 선택은 과목명 입력이 아니라 서버가 제공한 `curriculumCourseId`를 선택하는 방식으로 제한한다.

## 입력 계약

```ts
type CurriculumResolutionInput = {
  schoolId: string;
  departmentId: string;
  admissionYear: number;
  studentType: "freshman" | "transfer" | "double_major" | "minor" | "current_student";
  transferAdmissionYear?: number;
  doubleMajorDepartmentId?: string;
  minorDepartmentId?: string;
};
```

입력은 server-side에서 profile/session과 대조한다. 학생이 제출한 `schoolId`·`departmentId`가 `profiles` 및 `student_profiles`와 충돌하면 저장하지 않고 `manual_review`를 반환한다. 학생 개인정보와 원문 PDF는 client에 전달하지 않는다.

## `resolveStudentCurriculum()` 결정 순서

1. signed session의 student profile을 확인한다. 교수·관리자·미로그인 요청은 거부한다.
2. `profiles.school_id`, `profiles.department_id`, `student_profiles.user_types`, `grade`, `semester`를 읽는다. 입학연도는 authoritative 입력 또는 검증된 별도 source가 없으면 unresolved로 둔다.
3. `curriculum_versions.status=published` 중 학교·학과가 일치하고 admission year 범위가 포함되는 후보를 찾는다.
4. 학생 유형 범위와 transfer/double-major/minor 조건을 적용한다.
5. `curriculum_requirement_exceptions`를 우선순위와 적용 범위로 평가한다. 동일 우선순위의 충돌, 후보 0건, 후보 2건 이상은 자동 선택하지 않는다.
6. 하나의 확정 후보만 있으면 `student_curriculum_assignments`에 active assignment를 생성하거나 기존 assignment를 재사용한다. 이번 단계에서는 실제 저장을 수행하지 않는다.
7. 선택된 version의 `curriculum_courses`, `curriculum_requirements`, `career_tracks`를 읽어 응답용 DTO로 만든다.

### 결정 결과

```ts
type CurriculumResolutionResult = {
  status: "resolved" | "manual_review" | "unresolved";
  curriculumVersionId: string | null;
  departmentName: string | null;
  admissionYear: number | null;
  graduationSummary: {
    minimumCredits: number | null;
    requiredCredits: number | null;
    language: "required" | "not_required" | "unresolved";
    autoCheckable: boolean;
  };
  appliedRuleCodes: string[];
  reviewReasons: string[];
  courseGroups: CurriculumCourseGroup[];
};
```

`manual_review`는 오류가 아니라 공식 규칙이 충돌하거나 입력 근거가 부족하다는 상태다. 이 상태에서는 임의의 curriculum version이나 졸업 가능 여부를 표시하지 않는다.

## 과목 목록 응답 계약

```ts
type CurriculumCourseGroup = {
  key: string;
  label: string;
  courses: Array<{
    curriculumCourseId: string;
    courseId: string | null;
    courseName: string;
    credits: number | null;
    requirementType: string;
    recommendedGrade: number | null;
    recommendedSemester: number | null;
    currentStudentStatus: "completed" | "recognized" | "not_completed" | "unresolved";
    sourcePage: number | null;
  }>;
};
```

권장 그룹은 1학년 1학기, 1학년 2학기, 2학년 1학기, 2학년 2학기, 3학년 1학기, 3학년 2학기, 4학년 1학기, 4학년 2학기, 전공필수, 전공선택, 기타 필수로 분리한다. 원문이 학기 배치를 제공하지 않으면 `recommendedGrade`·`recommendedSemester`를 null로 두고 `reviewReasons`에 기록한다.

## 학생 과목 상태

학생 과목 카드에는 다음 세 가지 이상의 상태가 필요하다.

- `completed`: 공식 성적 또는 검증된 이수 기록이 있음
- `recognized`: 편입·복수전공·대체 인정 등으로 해당 요건에 인정됨
- `not_completed`: 적용 교육과정에 아직 인정되지 않음
- `unresolved`: 매칭 또는 공식 검증이 부족함

현재 `student_courses`의 `completed/interested/recommended`는 원래 수강·관심·추천 의미다. `interested`나 `recommended`를 completed/recognized로 해석하지 않는다. `student_course_records.is_verified=true`인 row와 공식 성적 source만 졸업계산에 반영한다. 학생의 수동 선택은 `student_course_records`를 직접 확정하지 않고 review 대상 입력으로 저장한다.

## 선택 저장 계약

```ts
type SaveStudentCourseSelectionsInput = {
  curriculumVersionId: string;
  selectedCourseIds: string[];
  recognitionRequests?: Array<{
    curriculumCourseId: string;
    source: "transfer" | "double_major" | "minor" | "equivalency";
    note?: string;
  }>;
};
```

서버는 다음을 재검증한다.

1. session 학생이 해당 `curriculumVersionId`의 active assignment를 가졌는지
2. 모든 ID가 해당 version에 속하는지
3. published course가 아닌 draft/unresolved row를 선택하지 않았는지
4. 선택 과목이 기존 `student_courses`의 관심·추천 row와 의미가 다른지
5. recognition request가 공식 equivalency 또는 예외 근거를 갖는지

학생이 과목명을 직접 입력해 새 `courses` row를 만들거나 기존 과목과 자동 매칭하는 경로는 제공하지 않는다.

## `calculateGraduationProgress()` 계산

계산은 결과와 근거를 함께 반환한다.

```ts
type GraduationProgressResult = {
  status: "calculated" | "partial" | "manual_review";
  totalCredits: { earned: number; required: number | null; progressRatio: number | null };
  majorCredits: { earned: number; required: number | null };
  requiredCourses: { completed: number; total: number; missingCourseIds: string[] };
  languageRequirement: { status: "met" | "unmet" | "not_required" | "unresolved"; reason: string };
  exceptionChecks: Array<{ code: string; status: "applied" | "unresolved"; reason: string }>;
  unresolvedItems: string[];
  sourceReferences: Array<{ type: "bluebook" | "official_record" | "manual_review"; reference: string }>;
};
```

계산 규칙:

- 총학점은 검증된 `student_course_records.credits_earned`만 합산한다.
- 같은 과목이 여러 source에 있으면 equivalency와 version rule을 먼저 적용해 중복 학점을 막는다.
- 필수과목은 `curriculum_requirements.rule_definition`의 course set과 `completed/recognized` records로 판정한다.
- 언어·P/F·졸업시험은 해당 requirement가 명시되고 검증 source가 있을 때만 `met`로 표시한다.
- 예외가 불명확하면 보수적으로 `manual_review`로 남긴다.
- progress ratio는 졸업 가능성·취업 가능성의 확정 판정이 아니다. 참고용 결과와 근거만 표시한다.

## 학생에게 보여줄 응답과 숨길 정보

보여줄 수 있는 값은 학과명, 적용 version label, 입학연도, 과목명·학점·요건 유형, 검증 상태, 졸업요건 진행률, unresolved 경고다. 학생 UUID, 다른 학생 기록, 교수 이메일, service-role key, PDF raw text는 반환하지 않는다.

## 오류·불확실성 처리

- curriculum version 후보가 없으면 `unresolved`와 “공식 교육과정 확인 필요”를 반환한다.
- 후보가 여러 개면 가장 최근 version을 임의 선택하지 않고 `manual_review`로 둔다.
- bluebook course와 `courses`가 매칭되지 않으면 `courseId=null`, `unresolved`로 표시한다.
- 블루북이 권장 순서만 제시한 경우 prerequisite로 변환하지 않는다.
- PDF 발행연도·최신성·시험요건이 불명확하면 graduation summary에 반영하지 않고 warning으로 남긴다.

## 보안 경계

초기 demo session에서도 role만 믿지 않고 서버가 profile, student_profile, assignment, course record 관계를 확인한다. Supabase service-role client는 server-only 모듈에서만 사용한다. 실제 Auth 전환 이후에는 `auth.uid()` 기반 RLS와 server validation을 병행하며, 학생이 다른 학생의 assignment나 record를 조회·수정할 수 있는 정책을 만들지 않는다.

## 구현 순서와 보류

1. `1-D-2`: schema migration 설계 검토 후 테이블·constraint·RLS를 별도 migration으로 구현
2. `1-D-3/1-D-4`: 법학·전자공학 source를 동일 JSON 계약으로 정규화하고 매칭 검토
3. `1-D-5`: 승인된 데이터만 제한적으로 seed하고 row count/FK 검증
4. `1-D-6`: onboarding server contract와 curriculum assignment 연결
5. `1-D-7/1-D-8`: 선택 저장과 졸업계산을 구현

현재는 source edition, 전자공학과 원문 추출, 학생 입학연도 authoritative source가 확정되지 않아 DB 입력과 자동 졸업판정은 보류한다.
