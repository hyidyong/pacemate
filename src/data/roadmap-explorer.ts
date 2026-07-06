export type RoadmapPhase = {
  label: string;
  title: string;
  reason: string;
};

export type RoadmapCourse = {
  id: string;
  code: string;
  name: string;
  category: string;
  credit: number;
  professor: string;
  dayLabel: string;
  timeLabel: string;
  classroom: string;
  priority: "core" | "recommended" | "support";
  shortReason: string;
  order: RoadmapPhase[];
  basics: string[];
  generalStudyMethod: string[];
  courseStudyMethod: string[];
  weeklyFocus: string[];
};

export const roadmapSemester = {
  label: "2026학년도 2학기",
  totalCredit: 18,
  studentType: "법학과 3-4학년 / 심화 전공",
  summary:
    "절차법, 행정구제, 회사법, 사례풀이를 함께 묶어 시험 대비와 실무형 사고를 같이 키우는 구성입니다.",
} as const;

export const roadmapCourses: RoadmapCourse[] = [
  {
    id: "civil-procedure-2",
    code: "21139-01",
    name: "민사소송법(2)",
    category: "전공선택",
    credit: 3,
    professor: "박성은",
    dayLabel: "화/목",
    timeLabel: "09:00-10:15 / 15:00-16:15",
    classroom: "오311",
    priority: "core",
    shortReason: "민사소송법 I과 민법 이해가 있어야 후반 절차를 따라가기 쉽습니다.",
    order: [
      {
        label: "1순위",
        title: "민법 기본 개념 재정리",
        reason: "청구권, 요건사실, 항변 구조를 알아야 변론과 증거 파트를 놓치지 않습니다.",
      },
      {
        label: "2순위",
        title: "민사소송법 I 복습",
        reason: "소송요건과 당사자 구조가 후반부 판결, 상소, 병합소송 이해의 바탕입니다.",
      },
      {
        label: "3순위",
        title: "증거와 판결 효력 집중 학습",
        reason: "중간 이후 난도가 올라가는 구간이라 사례와 조문을 같이 봐야 합니다.",
      },
    ],
    basics: ["민법상 청구권", "소송요건", "당사자와 항변", "증명책임", "기판력"],
    generalStudyMethod: [
      "매주 강의 전 목차와 주요 조문을 먼저 읽고, 강의 후 판례 키워드 5개만 정리하세요.",
      "절차 흐름은 문장 암기보다 도식화가 효율적입니다. 소 제기부터 판결 확정까지 화살표로 연결하세요.",
      "시험 대비는 사례형 질문을 기준으로 쟁점, 근거, 결론 순서의 짧은 답안을 반복하세요.",
    ],
    courseStudyMethod: [
      "8주차 전까지 변론과 증거 파트를 중간고사 범위로 가정하고 기출 문장으로 개념을 확인하세요.",
      "12주차 판결의 효력 부분은 기판력 예외와 상소 구조를 비교표로 정리하세요.",
      "평가 비중상 시험 관리가 중요하므로 출석과 과제보다 복습 시간을 먼저 고정하는 편이 안전합니다.",
    ],
    weeklyFocus: ["변론 준비", "증거조사", "증명책임", "판결 효력", "상소 절차"],
  },
  {
    id: "administrative-remedies",
    code: "44359-01",
    name: "행정절차와행정구제",
    category: "전공선택",
    credit: 3,
    professor: "김영수",
    dayLabel: "월/목",
    timeLabel: "15:00-16:15 / 09:00-10:15",
    classroom: "쉐106",
    priority: "core",
    shortReason: "행정법기초 이후 행정절차, 행정쟁송, 국가배상까지 이어지는 핵심 후속 과목입니다.",
    order: [
      {
        label: "1순위",
        title: "행정법기초 복습",
        reason: "행정행위, 행정입법, 행정계약의 기본 구조가 행정절차 파트의 전제입니다.",
      },
      {
        label: "2순위",
        title: "절차와 구제 흐름 연결",
        reason: "처분 절차의 하자가 행정심판과 행정소송에서 어떻게 다투어지는지 연결해야 합니다.",
      },
      {
        label: "3순위",
        title: "기출 판례 중심 정리",
        reason: "교수 계획상 국가시험 기출과 판례 소개가 병행되므로 판례 사실관계를 짧게 정리하는 습관이 필요합니다.",
      },
    ],
    basics: ["행정행위", "행정절차법", "처분절차", "행정심판", "취소소송"],
    generalStudyMethod: [
      "행정작용의 종류를 먼저 분류한 뒤, 각 작용에 붙는 절차적 권리와 구제수단을 연결하세요.",
      "판례는 결론만 외우지 말고 처분, 하자, 구제수단, 법원의 판단 순서로 요약하세요.",
      "공무원시험 대비 비중이 큰 과목이므로 매주 기출 선택지 10개를 OX로 점검하세요.",
    ],
    courseStudyMethod: [
      "1-7주차는 행정절차와 실효성 확보수단, 9주차 이후는 행정심판/행정소송으로 나누어 노트를 분리하세요.",
      "11-13주차 행정소송 파트는 소송의 대상, 당사자, 재판관할, 취소소송 요건을 표로 정리하세요.",
      "기말 비중이 높으므로 9주차 이후 구제법 파트는 매주 누적 복습을 권장합니다.",
    ],
    weeklyFocus: ["행정절차법", "정보공개", "행정상 강제집행", "행정심판", "행정소송", "국가배상"],
  },
  {
    id: "company-law",
    code: "19374-01",
    name: "회사법",
    category: "전공선택",
    credit: 3,
    professor: "김재두",
    dayLabel: "월/목",
    timeLabel: "16:30-17:45 / 10:30-11:45",
    classroom: "쉐106",
    priority: "recommended",
    shortReason: "상법총론을 바탕으로 주식회사 설립, 주주, 기관, 재무질서를 체계적으로 다루는 과목입니다.",
    order: [
      {
        label: "1순위",
        title: "상법총론 복습",
        reason: "강의계획서상 추천 선수과목이 상법총론이며, 회사법의 개념과 상행위 이해에 필요합니다.",
      },
      {
        label: "2순위",
        title: "주식회사 구조 파악",
        reason: "학기 대부분이 주식회사의 설립, 주주, 운영기구, 재무질서에 집중됩니다.",
      },
      {
        label: "3순위",
        title: "조문과 사례 연결",
        reason: "회사법은 용어와 조문 구조가 중요하므로 사례를 볼 때 조문 번호를 같이 적어야 합니다.",
      },
    ],
    basics: ["상법총론", "회사의 종류", "주식회사 설립", "주주권", "이사와 이사회"],
    generalStudyMethod: [
      "회사법은 구조 과목입니다. 회사의 설립, 자금조달, 기관운영, 기본적 변경 순서로 큰 지도부터 만드세요.",
      "주주총회, 이사회, 대표이사, 감사의 권한을 비교표로 정리하면 후반부가 훨씬 편해집니다.",
      "중간 30%, 기말 30%, 과제 20%라 시험과 과제 모두 균형 있게 관리해야 합니다.",
    ],
    courseStudyMethod: [
      "6-8주차 주주의 권리와 주주명부 파트는 중간고사 설명과 이어지므로 사례형 쟁점을 따로 모으세요.",
      "9-11주차 운영기구 파트는 주주총회, 이사, 이사회, 대표이사, 감사제도를 한 장 표로 압축하세요.",
      "13-15주차는 회사 형태와 조직변경, 합병, 분할을 비교하는 방식으로 정리하세요.",
    ],
    weeklyFocus: ["회사의 개념", "주식회사 설립", "주주권", "주주총회", "이사회", "합병과 분할"],
  },
  {
    id: "civil-law-cases",
    code: "21082-02",
    name: "민법사례연습",
    category: "전공선택",
    credit: 3,
    professor: "김도현",
    dayLabel: "월/수",
    timeLabel: "10:30-11:45",
    classroom: "법학관 204",
    priority: "recommended",
    shortReason: "민사소송법의 사례 답안 감각을 같이 끌어올리는 보조 과목입니다.",
    order: [
      {
        label: "1순위",
        title: "채권총론 핵심 쟁점",
        reason: "이행지체, 손해배상, 해제 쟁점이 사례 답안의 기본 뼈대입니다.",
      },
      {
        label: "2순위",
        title: "물권 변동과 등기",
        reason: "부동산 집행과 보전처분 이해로 연결됩니다.",
      },
      {
        label: "3순위",
        title: "답안 목차 훈련",
        reason: "사실관계에서 쟁점을 뽑아내는 속도를 높이는 단계입니다.",
      },
    ],
    basics: ["채권총론", "물권 변동", "계약 해제", "손해배상", "소멸시효"],
    generalStudyMethod: [
      "사례는 결론부터 외우지 말고 사실관계에 제시된 날짜와 행위를 먼저 표로 정리하세요.",
      "한 문제를 오래 붙잡기보다 20분 안에 목차를 세우는 반복 훈련이 좋습니다.",
    ],
    courseStudyMethod: [
      "민사소송법(2)에서 나온 절차 쟁점을 민법 사례의 청구원인과 함께 연결해 보세요.",
      "매주 한 문제를 실제 답안처럼 작성하고, 나머지는 목차만 빠르게 세우는 방식이 효율적입니다.",
    ],
    weeklyFocus: ["청구권 기초", "채무불이행", "물권 변동", "부당이득", "사례 답안"],
  },
  {
    id: "commercial-law",
    code: "22014-01",
    name: "상법총론",
    category: "전공필수",
    credit: 3,
    professor: "이서진",
    dayLabel: "금",
    timeLabel: "13:30-16:15",
    classroom: "법학관 301",
    priority: "support",
    shortReason: "회사법을 듣기 전 상인, 상행위, 상업사용인 등 상법의 기본 언어를 잡는 과목입니다.",
    order: [
      {
        label: "1순위",
        title: "민법 법률행위 복습",
        reason: "상행위 특칙을 이해하려면 민법의 일반 원칙과 차이를 알아야 합니다.",
      },
      {
        label: "2순위",
        title: "상인과 상행위 구분",
        reason: "초반 정의가 뒤의 상업사용인, 상호, 상업양도 파트에 반복됩니다.",
      },
      {
        label: "3순위",
        title: "조문 키워드 정리",
        reason: "상법은 조문 적용과 키워드 문구가 시험에서 같이 묻히는 편입니다.",
      },
    ],
    basics: ["법률행위", "대리", "상인", "상행위", "상업양도"],
    generalStudyMethod: [
      "민법 원칙과 상법 특칙을 2열 표로 비교하면 암기량이 줄어듭니다.",
      "정의 조문은 짧게 반복하고, 키워드는 사실관계 옆에 요약을 붙여 기억하세요.",
    ],
    courseStudyMethod: [
      "회사법 선수 지식으로 쓰이므로 상인, 상행위, 상업사용인 개념은 회사법 수강 전 다시 확인하세요.",
      "민법사례연습에서 나온 법률행위 쟁점을 상법 특칙과 비교해 보세요.",
    ],
    weeklyFocus: ["상인", "상행위", "상업사용인", "상호", "상업양도"],
  },
  {
    id: "legal-writing",
    code: "23031-01",
    name: "법문서작성",
    category: "전공선택",
    credit: 3,
    professor: "정하린",
    dayLabel: "금",
    timeLabel: "09:00-11:45",
    classroom: "봉경관 118",
    priority: "support",
    shortReason: "절차법과 사례연습에서 배운 내용을 문서화하는 실전 과목입니다.",
    order: [
      {
        label: "1순위",
        title: "사실관계 정리",
        reason: "문서 작성은 법리보다 사실을 빠짐없이 구조화하는 능력이 먼저입니다.",
      },
      {
        label: "2순위",
        title: "청구취지와 청구원인",
        reason: "민사소송법의 변론 구조와 직접 연결됩니다.",
      },
      {
        label: "3순위",
        title: "문서 검토 루틴",
        reason: "제출 전 요건, 날짜, 당사자 표시를 반복 확인해야 실수가 줄어듭니다.",
      },
    ],
    basics: ["사실관계표", "청구취지", "청구원인", "증거목록", "문장 간결성"],
    generalStudyMethod: [
      "완성본을 읽는 것보다 초안을 직접 써보고 피드백 기준으로 고치는 방식이 가장 빠릅니다.",
      "긴 문장은 사실, 법리, 결론으로 분리해 짧게 나누세요.",
    ],
    courseStudyMethod: [
      "민사소송법(2)의 변론, 증거 파트와 맞춰 소장 또는 준비서면 구조를 연습하세요.",
      "금요일 수업 후 목요일 저녁에 30분 초안을 써두면 실습 시간 활용도가 높아집니다.",
    ],
    weeklyFocus: ["사실관계", "소장", "준비서면", "증거목록", "최종 검토"],
  },
];

export function getRoadmapCourseById(courseId: string) {
  return roadmapCourses.find((course) => course.id === courseId) ?? null;
}
