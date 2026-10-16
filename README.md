# 덕메

K팝 팬이 최애 아이돌의 착용템과 성지(다녀간 장소)를 따라 할 수 있게 돕는, 내 덕질을 기억하는 AI 비서.
자세한 기획은 [PRD.md](PRD.md) 참고.

## 시연 당일 — 빠른 안내

### 서버 켜기

```sh
npm install        # 처음 한 번만
npm start
```

터미널에 뜨는 두 주소 중 하나로 접속:

- `http://localhost:3000` — 이 노트북에서
- `http://<와이파이 IP>:3000` — 같은 와이파이에 있는 팀원 노트북/휴대폰에서 (와이파이가 바뀌면 IP도 바뀜 — 서버 켤 때마다 터미널에 새로 찍힘)

### 서버 끄기

터미널에서 `Ctrl + C`. (`npm start`를 돌린 그 터미널 창에서 끄면 됨)

### 시연 중간에 처음부터 다시 하고 싶을 때

화면 오른쪽 위 **"기억 초기화"** 버튼. 대화·기억(최애/사이즈/예산)·찜·보유·방문 기록·구매 연결 카운터까지 전부 비워지고, 시나리오 1부터 다시 시작할 수 있는 상태가 됨.

("새 대화" 버튼은 대화창만 비우고 기억은 남겨둠 — 기억이 유지되는 걸 보여주고 싶을 때 씀.)

### 문제가 생겼을 때 — 마지막 정상 커밋으로 되돌리기

1. 지금까지 어떤 커밋들이 있는지 보기:

   ```sh
   git log --oneline
   ```

2. 화면/동작이 이상해졌는데 원인을 모르겠으면, 마지막으로 정상 작동했던 커밋으로 되돌리기:

   ```sh
   git stash        # 혹시 저장 안 된 변경이 있으면 일단 치워둠 (나중에 git stash pop으로 복구 가능)
   git reset --hard <커밋 해시>   # 예: git reset --hard d751b2d
   npm install       # package.json이 바뀐 커밋으로 되돌렸다면 한 번 더
   npm start
   ```

   `<커밋 해시>`는 `git log --oneline`에서 왼쪽에 나오는 7자리 값. 시연 직전에 안정적으로 돌았던
   커밋 해시를 메모해두면 좋음 (이 README 맨 아래 "체크포인트" 표 참고).

3. `.env` 파일은 git에 올라가지 않으므로(`.gitignore`), `git reset --hard`로 지워지지 않음 — 안심하고 되돌려도 됨.

4. 되돌린 뒤에도 안 되면, `app-state/`와 `.croche/` 폴더를 지우고 다시 시작 (기억이 전부 초기화됨):

   ```sh
   rm -rf app-state .croche
   npm start
   ```

### 자주 막히는 지점

| 증상 | 원인/조치 |
|---|---|
| `CROCHE_PROJECT_KEY / CROCHE_DEBUG_KEY가 없어요` | `.env` 파일이 없거나 비어있음. `node_modules`나 `.env`를 지운 적이 있다면 `croche debug-keys create --project <프로젝트ID>`로 다시 발급 |
| `node: .env: not found` | `.env` 파일이 프로젝트 루트(`dukme/`)에 없음. 터미널 현재 위치가 `dukme/` 폴더인지 확인 |
| 포트 3000이 이미 사용 중 | 이전에 띄운 서버가 안 꺼진 상태. `lsof -i :3000`으로 PID 찾아서 `kill <PID>`, 또는 `PORT=3001 npm start`로 다른 포트 사용 |
| 같은 와이파이 팀원이 접속 안 됨 | 같은 와이파이인지 확인, 맥북 방화벽이 들어오는 연결을 막고 있는지 확인(시스템 설정 → 네트워크 → 방화벽) |

## 개발용 명령어

```sh
npm start            # 서버 실행 (localhost:3000)
npm run dev           # 파일 바뀌면 자동 재시작
npm run typecheck     # TypeScript 타입 체크만
npm run scenario      # 시나리오 1~6 자동 실행 + 모델별 비교 (docs/results.md 참고)
```

## 구조

- `data/items.json`, `data/places.json`, `data/aliases.json` — 목데이터 (나중에 실제 DB로 교체 가능, PRD §6)
- `src/server.ts` — Croche 연결 + 웹 서버
- `src/tools/` — Croche Tool 6종 (searchItem/findAlternative/addWishlist/planRoute/updateOwned/markVisited)
- `src/state.ts` — 찜/보유/방문 목록의 앱 authoritative 저장소 (`app-state/`, FileStorage와 별도)
- `public/index.html` — 채팅 화면 1장
- `docs/notes.md` — 작업 중 판단 기록, `docs/results.md` — 모델 비교·페르소나 테스트 결과

## 체크포인트 (안정적으로 작동 확인된 커밋)

시연 리허설 중 "이 커밋은 확실히 잘 됐다"고 확인될 때마다 아래에 추가해두면, 문제가 생겨도 빠르게 되돌릴 수 있음.

| 날짜 | 커밋 | 확인한 내용 |
|---|---|---|
| 2026-10-15 | `3fd4bf7` | 시나리오 1~3 (오늘 밤 범위) |
| 2026-10-16 | (진행 중) | 시나리오 1~6 전체 |
