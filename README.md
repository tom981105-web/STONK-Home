# STONK Home v1.10.0

## 핵심 수정

- `index.html`의 CSS/JS 캐시 버전을 `v=1.10.0`으로 갱신했습니다.
- GitHub Pages에서 예전 `home.js?v=1.8.0`이 계속 불러와져 Market Pulse 연동 코드가 적용되지 않던 문제를 방지합니다.
- Market Pulse는 `rooms/{방코드}`를 직접 구독하고, `marketPulse/pulse`가 있으면 우선 표시하며 없으면 `stocks + latestNews`로 자동 구성합니다.

## 확인 방법

브라우저 개발자도구 Console에서 아래처럼 확인하세요.

```js
SiteConfig.VERSION
```

`home-1.10.0`이 떠야 최신 파일이 적용된 상태입니다.

## 적용 주소

- Battle: `https://tom981105-web.github.io/STONK-Battle/`
- Board: `https://tom981105-web.github.io/STONK-Board/`
- Wiki: `https://tom981105-web.github.io/STONK-Wiki/`
- Admin: `https://tom981105-web.github.io/STONK-Admin/market-admin.html`


## v1.13.0 수정
- PC 화면에서 우측 방 입장 카드가 STONK Sites 카드 위로 겹치던 문제 수정
- `main` 전체 Grid + sticky 구조 제거
- Hero 영역만 2단 가로 배치, Market Pulse / Sites / How to Play는 정상 흐름으로 배치
- Firebase 사용량 최소화 구조는 v1.12.0 그대로 유지


## v1.14.0
- Hero 영역의 "방 코드 입력" 버튼 제거
- 데스크톱에서 좌/우 상단 카드 높이와 균형 조정
- 좌측 Hero 카드를 더 넓고 크게 조정
- btnScrollJoin 제거에 맞춰 JS 이벤트 바인딩 안전 처리


## v1.15.0
- STONK Arcade 사이트 추가
- 상단 메뉴, 방 입장 카드, 사이트 카드에 Arcade 연결 추가
- Arcade 배포 주소: https://tom981105-web.github.io/STONK-Arcade/
- 방 코드 입력 시 Arcade에도 `?room=방코드`를 붙여 이동
- 연동 사이트 수 4개에서 5개로 변경
