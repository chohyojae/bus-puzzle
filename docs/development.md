# 개발·테스트·배포

기본 주소는 `/bus-puzzle/`입니다. 어느 화면을 수정하는지에 따라 라운드 정의와 렌더러, 검증 방법이 달라집니다. [앱 진입점](../src/main.tsx)

| 화면        | 개발 서버 경로           | 구현과 검증                                                                                                                                                               |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 정류장 | `/bus-puzzle/`           | React와 SVG로 그립니다. 차량 배치, 순환로, 승객의 입장·탑승 규칙은 코드로 정의합니다. [정류장 엔진](depot-engine.md)                                                      |
| 클래식      | `/bus-puzzle/?classic=1` | JSON 라운드를 읽고 PixiJS로 그립니다. 콘텐츠 스크립트와 풀이 탐색기를 사용합니다. [라운드 목록](../src/content/rounds/catalog.ts) · [렌더러](../src/game/render/scene.ts) |

두 화면은 브라우저 저장소와 설정·백업 화면을 공유합니다. 작업 중인 판을 옮기거나 구버전 기록을 검증하는 방법은 별도 문서에 있습니다. [저장과 백업](storage-and-backup.md)

## 로컬 실행

저장소 루트에서 아래 명령을 실행합니다. 패키지 관리자는 Bun 1.4.5로 고정돼 있습니다. 검증에 사용한 Node.js는 26.13.1입니다. Vitest와 Playwright의 백업 테스트는 `node:zlib`의 Zstandard 함수를 사용합니다. [Bun 버전](../.bun-version) · [패키지와 스크립트](../package.json)

```sh
bun ci
bun run dev
```

개발 서버의 기본 주소는 `http://127.0.0.1:5173/bus-puzzle/`입니다. 5173번 포트를 이미 사용 중이면 Vite가 터미널에 출력한 주소를 엽니다.

빌드 결과를 확인할 때는 개발 서버와 별도로 다음 명령을 사용합니다.

```sh
bun run build
bun run preview --port 4173 --strictPort
```

빌드는 클래식 라운드 검증, TypeScript·Biome 검사, Vite 빌드 순서로 진행합니다. 결과물인 `dist/`를 `http://127.0.0.1:4173/bus-puzzle/`에서 확인할 수 있습니다. 소스를 바꾼 뒤에는 다시 빌드해야 미리보기에 반영됩니다. [빌드 스크립트](../package.json) · [Vite 설정](../vite.config.ts)

## 변경 사항에 맞는 검사

| 확인할 내용                          | 명령                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| TypeScript 타입, Biome 포맷·린트     | `bun run check`                                                                           |
| Biome 포맷 및 자동 수정 적용         | `bun run format`                                                                          |
| 전체 단위 테스트                     | `bun run test`                                                                            |
| 기본 정류장의 충돌·탑승·단계별 풀이  | `bun run test tests/depot-logic.test.ts`                                                  |
| 이어하기·되돌리기, 백업, FPS         | `bun run test tests/depot-session.test.ts tests/storage.test.ts tests/frame-rate.test.ts` |
| 클래식 이동 규칙, 라운드 생성과 풀이 | `bun run test tests/engine.test.ts tests/content-solver.test.ts`                          |

Vitest는 Node 환경에서 `tests/**/*.test.ts`를 실행합니다. 정류장 테스트는 실제 경과 시간을 입력으로 주어 차량·승객 위치를 비교하고, 저장소 테스트는 `fake-indexeddb`로 기록 충돌과 복구를 재현합니다. [Vitest 설정](../vitest.config.ts) · [Biome 설정](../biome.json) · [테스트 파일](../tests/)

### 브라우저 테스트

```sh
bunx playwright install chromium webkit
bun run build
bun run test:e2e
```

Playwright가 4173번 포트에서 미리보기 서버를 시작합니다. 로컬에서는 같은 주소에 떠 있는 서버를 재사용하므로 테스트할 빌드를 제공하고 있는지 확인합니다. 기본 설정은 한 번에 한 테스트를 실행하며, CI에서는 실패한 테스트를 한 번 재시도합니다. [Playwright 설정](../playwright.config.ts)

| 프로젝트          | 실행 대상                                  |
| ----------------- | ------------------------------------------ |
| `chromium`        | 데스크톱 Chrome 프로필의 Chromium          |
| `mobile-chromium` | iPhone 13 화면·터치 설정을 적용한 Chromium |
| `webkit`          | 데스크톱 Safari 프로필의 WebKit            |

예를 들어 터치로 대각선 차량을 출차하는 동작만 반복하려면 `bun run test:e2e --project=mobile-chromium --grep="diagonally parked"`를 실행합니다. 브라우저 테스트는 지붕 화살표와 실제 이동 방향, 저장 직후 새로고침, 막힌 판 되돌리기, 단계 전환, 두 탭의 저장 충돌, 오프라인 백업 가져오기까지 확인합니다. 실패한 실행의 trace는 `test-results/` 아래에 남습니다. [정류장 시나리오](../tests/e2e/depot.spec.ts) · [클래식·백업 시나리오](../tests/e2e/game.spec.ts)

## 클래식 라운드 작성

라운드 하나는 `src/content/rounds/<id>/` 아래에 둡니다. `round.json`은 플레이에 쓰는 정의이고, `assets/`에는 해당 라운드의 장식 이미지를 둡니다. 생성기로 만든 `authoring.json`에는 시드, 검증에 사용한 출차 순서와 풀이 결과가 들어갑니다. 앱은 Vite의 `import.meta.glob`으로 각 폴더의 `round.json`과 에셋을 찾아 등록합니다. [예시 라운드](../src/content/rounds/round-001/round.json) · [생성 기록 예시](../src/content/rounds/round-003/authoring.json) · [카탈로그 로더](../src/content/rounds/catalog.ts)

```sh
bun run generate:round --id=round-004 --seed=24019 --difficulty=medium
bun run solve:round --round=round-004 --max-states=200000
bun run validate:rounds
```

생성 예시는 새 `round-004` 폴더를 만듭니다. 이미 존재하는 ID로 실행하면 폴더 생성 단계에서 중단됩니다. `easy`는 6대, `medium`은 9대, `hard`는 12대를 배치합니다. 생성기는 배치 순서의 역순으로 차량을 출차시켜 모든 승객을 태울 수 있는지 확인합니다. 생성 직후 `order`는 100, `unlockAfter`는 빈 배열이므로 실제 목록의 순서와 해금 조건에 맞게 지정합니다. [생성 CLI](../scripts/generate-round.ts) · [생성 알고리즘](../src/game/domain/generator.ts)

검증이 실패하면 다음 순서로 확인합니다.

1. 폴더명과 `id`가 같은지, `assets.decoration`이 실제 `./assets/` 안의 파일을 가리키는지 확인합니다.
2. 클래식 스키마의 색은 빨강·파랑·노랑·초록이고 차량 방향은 상하좌우입니다. 차량 좌표가 0부터 시작하는 격자 안에 있는지, 한 칸에 두 대가 겹치지 않는지, 색별 좌석 합계와 승객 수가 같은지 확인합니다.
3. `unlockAfter`의 ID가 존재하는지, 해금 조건이나 차량의 출차 순서가 서로를 기다리는 순환 관계를 만들지 않는지 확인합니다.
4. 출차할 때는 빈 승강장을 차지하고, 맨 앞 승객과 색이 맞는 차량부터 탑승합니다. 같은 색 차량이 여러 대면 먼저 도착한 차량이 우선합니다. 풀이 탐색기는 가능한 출차를 깊이 우선으로 탐색하고 찾은 순서를 다시 재생합니다. `unsolvable`은 해가 없다는 결과이고, `inconclusive`는 상태 수나 시간 한도에 도달했다는 뜻입니다. 기본 한도는 200,000개 상태와 10초입니다. CLI에서 상태 수를 조절할 수 있습니다.

[스키마·카탈로그 검사](../src/content/round-schema.ts) · [파일 검사](../scripts/content.ts) · [클래식 게임 규칙](../src/game/domain/engine.ts) · [풀이 탐색기](../src/game/domain/solver.ts) · [전체 검증 CLI](../scripts/validate-rounds.ts)

라운드 수에 따른 빌드 크기는 `bun run measure:content`로 확인합니다. 임시 폴더에서 현재 예시 라운드를 복제해 3·30·100개 카탈로그를 빌드하고, 에셋 원본 크기·gzip 크기·빌드 시간·사전 캐시 규모를 출력합니다. 출력의 `buildMs`는 PWA 생성까지 포함한 빌드 시간입니다. [측정 스크립트](../scripts/measure-content.ts)

## 오프라인과 업데이트

프로덕션 빌드가 서비스 워커와 웹 앱 매니페스트를 생성합니다. Workbox는 HTML, JS, CSS, 이미지·폰트·오디오와 백업용 Zstandard WASM을 미리 캐시합니다. 캐시할 파일의 크기 한도는 파일당 3 MiB이고, 해당 범위 안의 페이지 탐색은 `index.html`로 연결합니다. 저장 기록은 IndexedDB에서 관리합니다. [PWA 설정](../vite.config.ts) · [저장과 백업](storage-and-backup.md)

오프라인 동작은 프로덕션 미리보기에서 다음과 같이 재현할 수 있습니다.

1. 온라인으로 기본 게임을 열고 **일시정지 → 설정**에서 오프라인 준비 완료 안내를 확인합니다.
2. 온라인 상태에서 한 번 새로고침합니다. 개발자 도구 콘솔에서 `navigator.serviceWorker.controller`를 확인하면 현재 페이지를 제어하는 서비스 워커를 볼 수 있습니다.
3. 개발자 도구의 네트워크를 **Offline**으로 바꾸고 같은 주소를 새로고침합니다. 차량을 출차하거나, 설정 화면에서 백업 파일을 내보내고 다시 선택해 미리보기가 열리는지 확인합니다.

새 서비스 워커가 대기 중이면 기본 게임에서는 설정 화면에, 클래식에서는 게임 화면을 벗어났을 때 업데이트 안내를 표시합니다. 사용자가 **업데이트**를 누르면 대기 중인 저장을 `flush()`한 뒤 새 버전을 적용합니다. 저장에 실패하면 백업 안내를 표시합니다. [업데이트 처리](../src/pwa/UpdateNotice.tsx)

## GitHub Pages와 하위 경로

`BASE_PATH`는 빌드 에셋 경로와 매니페스트의 `start_url`·`scope`·서비스 워커의 탐색 경로에 쓰입니다. `E2E_BASE_PATH`는 Playwright가 열 주소에 쓰입니다. 기본값은 모두 `/bus-puzzle/`입니다. 예를 들어 `/my-puzzle/`에 배포할 경우 다음처럼 같은 경로를 지정해 검증합니다.

```sh
BASE_PATH=/my-puzzle/ bun run build
BASE_PATH=/my-puzzle/ E2E_BASE_PATH=/my-puzzle/ bun run test:e2e --project=chromium
```

GitHub Actions는 `main` 푸시, PR, 수동 실행에서 의존성 설치·라운드 검증·타입 및 Biome 검사·단위 테스트·빌드를 실행합니다. 저장소 이름을 하위 경로로 사용해 데스크톱·모바일 Chromium 테스트를 수행하고, 통과한 `dist/`를 Pages 아티팩트로 업로드합니다. PR이 아닌 `main` 실행에서 배포 작업이 이어집니다. WebKit 검증은 로컬의 `--project=webkit`로 실행할 수 있습니다. [배포 워크플로](../.github/workflows/deploy.yml)

| 증상                                                            | 확인할 곳                                                                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 개발 화면은 뜨는데 미리보기 또는 배포에서 에셋이 404            | 빌드한 `BASE_PATH`, 브라우저 주소, 매니페스트의 `scope`가 같은 하위 경로인지 확인합니다.                                                  |
| 브라우저 테스트가 예전 UI를 찾거나 서버 준비에서 멈춤           | 현재 소스로 `dist/`를 다시 만들고, 4173번 포트에서 어떤 빌드와 경로를 제공하는지 확인합니다.                                              |
| 오프라인 첫 접속에서 화면이나 백업 기능이 열리지 않음           | 온라인에서 서비스 워커가 설치되고 페이지를 제어하는지, 빌드 출력의 precache와 네트워크 요청에 필요한 WASM·이미지가 포함됐는지 확인합니다. |
| 클래식 라운드를 추가했는데 기본 정류장의 색이나 배치가 그대로임 | 기본 정류장의 단계·차량 구성은 `src/game/depot/`에서 관리합니다. [정류장 엔진](depot-engine.md)                                           |

[프로젝트 README](../README.md)
