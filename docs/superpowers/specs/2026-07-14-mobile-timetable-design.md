# Mobile Timetable Design

## Goal

모바일 시간표가 화면 너비를 초과하지 않고, 좁은 셀 안에서도 과목명·교수명·강의실이 안정적으로 읽히도록 개선한다.

## Design

- 시간표는 `w-full min-w-0 overflow-hidden` 컨테이너를 사용한다.
- 그리드는 시간 컬럼과 5개 요일 컬럼을 비율 기반으로 구성한다.
- 과목 셀은 `p-1`, 파스텔 배경, `overflow-hidden`을 사용한다.
- 과목명은 2줄 말줄임과 `break-all`, 상세 정보는 1줄 말줄임을 적용한다.
- 기존 가로 스크롤과 짙은 카드 테두리는 제거한다.

## Scope

`src/components/mypage/my-page-planner.tsx`의 2D 시간표 영역과 관련 회귀 테스트만 수정한다.
