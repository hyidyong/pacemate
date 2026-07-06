export type SyllabusWeek = {
  week: number;
  topic: string;
};

export type EvaluationItem = {
  label: string;
  score: number;
  ratio: number;
};

export const sampleSyllabus = {
  course: {
    name: "민사소송법(2)",
    code: "21139-01",
    college: "사회과학대학",
    department: "법학과",
    category: "전공선택",
    credit: 3,
    professor: "박성은",
    phone: "053-580-5423",
    email: "zivilprozess_park@kmu.ac.kr",
    classroom: "오311",
    schedule: "화 09:00~10:15, 목 15:00~16:15",
    target: "법학과 4년",
    office: "쉐턱관 227",
  },
  overview:
    "민사절차법인 민사소송법 중에서도 관념적 형성절차인 판결절차에서 확정된 내용을 소위 사실적 형성 절차라고 하는 강제집행제도에 관한 여러 절차 및 제도, 즉 동산·부동산에 대한 집행, 가압류, 가처분 등에 관한 지식을 습득케 한다.",
  goals: [
    "민사소송법의 주요 제도 일반 및 주요 판례를 공부하여 실제 절차의 모습과 바탕 원칙을 이해한다.",
    "각종 시험의 민사소송법 준비가 될 수 있도록 판례와 민법 규정을 이해하고 파악한다.",
  ],
  method:
    "주차별 강의 순서에 따라 진행하되 주요 내용을 중심으로 강의하고, 사례와 기출문제를 통해 실질적 이해를 돕는다.",
  prerequisites: [
    "민법에 대한 전반적인 이해가 필요함",
    "민사소송법 I 강의를 수강했거나 이해했을 것을 전제로 함",
  ],
  useCases: ["로스쿨 및 변호사시험 준비", "법무사/법원공무원 등 임용시험 준비"],
  evaluation: [
    { label: "출석", score: 20, ratio: 20 },
    { label: "기말시험", score: 40, ratio: 40 },
    { label: "중간고사", score: 30, ratio: 30 },
    { label: "과제", score: 10, ratio: 10 },
  ] satisfies EvaluationItem[],
  weeks: [
    {
      week: 1,
      topic:
        "강의소개 및 민사소송 절차 개관 - 민사소송법(1) 내용 확인과 민사소송법(2) 구조 파악",
    },
    { week: 2, topic: "민사소송절차 개관 마무리 및 변론준비절차 개관" },
    { week: 3, topic: "변론의 준비 - 준비서면, 변론준비절차, 조기변론기일 등" },
    { week: 4, topic: "변론 - 변론의 종류와 원칙, 분리/병합, 변론조서, 변론기일" },
    { week: 5, topic: "변론의 내용 - 청구취지, 공격방어방법, 항변" },
    {
      week: 6,
      topic:
        "증거 - 증거방법과 증거자료, 증거능력과 증거력, 증거의 종류, 요증사실과 불요증사실",
    },
    { week: 7, topic: "증거조사의 개시 - 증거신청, 증거결정, 직권증거조사" },
    { week: 8, topic: "중간고사 및 문제풀이" },
    {
      week: 9,
      topic:
        "증거조사의 실시 - 증인신문, 감정, 서증, 검증, 당사자신문, 증거보전",
    },
    {
      week: 10,
      topic:
        "자유심증주의와 증명책임 - 자유심증주의의 내용과 예외, 증명책임의 분배·전환·완화",
    },
    {
      week: 11,
      topic: "소송의 종료 - 소송종료선언, 소취하, 청구의 포기/인낙, 화해, 종국판결",
    },
    { week: 12, topic: "판결의 효력 - 기속력, 기판력, 형성효" },
    { week: 13, topic: "병합소송 - 공동소송, 필수적/유사필수적 공동소송" },
    { week: 14, topic: "상소심절차 - 항고와 상소, 항소와 상고, 심리불속행, 상고이유" },
    { week: 15, topic: "기말평가" },
    { week: 16, topic: "보강 및 마무리" },
  ] satisfies SyllabusWeek[],
} as const;
