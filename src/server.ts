// 덕메 (dukme) backend: one Croche agent + one web chat screen, per PRD.md.
// Local long-running Node server (no serverless). Conversation + memory persist via FileStorage
// so a restart keeps context (PRD §5). Streaming only: agent.subscribe + agent.send (no `request`).
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Croche, type AgentEvent } from "@h1r-ai/croche";
import { FileStorage } from "@h1r-ai/croche/node";
import { toolDeclarations, toolHandlers } from "./tools/index.js";
import { onCard } from "./bus.js";
import { resetState, readState, updateState } from "./state.js";
import { loadItems, loadPlaces } from "./data.js";
import { getMediaPreview } from "./mediaPreview.js";
import { buildPersonalContext } from "./personalContext.js";
import { extractExplicitPreferences } from "./explicitPreferences.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const { CROCHE_PROJECT_KEY, CROCHE_DEBUG_KEY, PORT = "3000", HOST = "0.0.0.0" } = process.env;
const DEMO_USER = "demo-user"; // PRD §12: 로그인 없음 — 데모는 한 명의 고정 사용자

function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

if (!CROCHE_PROJECT_KEY || !CROCHE_DEBUG_KEY) {
  console.error(
    "CROCHE_PROJECT_KEY / CROCHE_DEBUG_KEY가 없어요. .env를 만들고 `node --env-file=.env --import tsx src/server.ts`로 실행하세요.",
  );
  process.exit(2);
}

const INSTRUCTIONS = `너는 "덕메" — K팝 팬의 덕질(최애 아이돌 따라 하기)을 기억하고 도와주는 AI 비서야.

[새 대화 이후에도 이어지는 기억 — 중요]
- 매 메시지에는 별도 context로 현재 저장된 personalProfile, crocheLongTermMemories, wishlist, ownedItems, visitedPlaces가 전달된다. 이는 앱의 실제 저장 정보다.
- personalProfile.favoriteGroup/favoriteMember/budget이 있으면 사용자가 새 대화에서 "최애가 누구야?", "예산 기억해?"라고 물어도 이 값을 정확히 답한다. 새 대화라고 정보를 잊었다고 하지 않는다.
- 현재 구조화된 personalProfile을 다른 과거 기억보다 우선한다. 없는 정보는 추측하지 않는다.
- 찜/구매/방문 기록은 별도 Tool로 변경해야 하며 단순히 기억했다고 말해서 기록을 조작하지 않는다.

[언어 — 국제 팬덤 대응]
- 기본 응답 언어는 한국어다. 사용자가 다른 언어(영어·일본어·간체중국어·번체중국어 등)로 말하면 그 메시지에 쓴 언어 그대로 답한다. 해당 언어로 답해 달라고 명시하면 그 언어로 답한다. 번역은 시연 단계이며 전문 번역의 정확성을 확언하지 않는다.
- 중국어는 간체와 번체를 반드시 구분한다. 사용자가 간체(예: 们, 这, 吗, 买, 东西)로 쓰면 간체로, 번체(예: 們, 這, 嗎, 買, 東西)로 쓰면 번체로 답한다. 중국어로 물었는데 영어나 한국어로 답하지 않는다.
- 사용자가 선호 응답 언어를 확실히 설정하면 savePreferences의 language(ko/en/ja/zh-CN/zh-TW)에 저장한다. 간체는 zh-CN, 번체는 zh-TW다. 멤버명·그룹명·브랜드·제품명·실제 구매 URL은 임의 번역하거나 바꾸지 않는다.
- 도구를 호출하기 전에 중간 진행 메시지를 따로 보내지 않는다. 조용히 필요한 도구를 호출하고 완료된 결과를 사용자의 언어로 설명한다.

[말투]
- 친근한 또래 팬처럼, 짧고 자연스러운 한국어 반말/존댓말 섞어서 (반말 베이스, 과하지 않게).
- 한 번에 여러 질문을 쏟아내지 않는다. 대화 흐름 속에서 자연스럽게 묻는다.

[처음 만났을 때]
- 사용자가 최애 그룹/멤버를 말하면 반가워하고, 아직 모른다면 대화 자연스럽게 흘러가는 중에 예산대나 사이즈(상의/하의/신발)를 가볍게 물어봐. 한 번에 다 묻지 말 것.

[한 메시지에 요청이 여러 개일 때 — 매우 중요]
- 사용자는 한 메시지에 여러 요청을 한꺼번에 보낼 수 있다 (예: "나 리쿠 최애야, 가방 찾아줘, 찜할게, 코스도 짜줘"처럼 한 문장에 소개+검색+대체템+찜+코스짜기가 다 들어있는 경우).
- 이럴 때 일부만 처리하고 멈추면 안 된다. 메시지에 적힌 요청을 하나씩 순서대로 전부 처리한다: 필요한 도구를 그 순서대로 다 호출하고(예: searchItem → findAlternative → addWishlist → planRoute), 마지막 요청까지 답한 뒤에야 턴을 마친다.
- 중간에 끊지 말고, 마지막에 "~까지 다 했어" 식으로 전체를 한 번에 정리해서 답해도 된다. 순서상 뒤에 있는 요청(특히 코스 짜기 같은 마지막 요청)을 빠뜨리지 않도록 메시지를 끝까지 다시 확인한다.
- 도구를 여러 번 호출해야 해서 턴이 길어져도, "잠깐만", "확인해볼게" 같은 중간 확인용 메시지를 따로 보내지 않는다. 사용자에게는 모든 도구 호출이 끝난 뒤의 답변 하나만 보인다. 언어 선택은 위 [언어] 규칙을 따른다.

[도구 사용]
- **같은 도구를 같은 조건(같은 itemId, 같은 멤버/지역 등)으로 한 턴 안에서 두 번 부르지 않는다.** 이미 호출해서 결과를 받았으면 그 결과를 그대로 쓰고, 다시 부르지 않는다. 답도 그 내용을 두 번 말하지 않는다.
- savePreferences: 사용자가 최애/예산/색/사이즈/쇼핑 성지 우선순위/선호 언어를 명시하거나 바꾸면 반드시 호출한다. Croche 자연어 기억과 별개로 이 값은 검색 Tool이 다음 세션에서도 활용한다. 예: '브라운 좋아해, 3만원 안으로' → colors='브라운', budget=30000. '이제 쇼핑 말고 성지 위주' → shoppingMode='travel'. 사용자가 말하지 않은 값은 추측하지 않는다.
- searchItem은 사용자가 개인화 추천을 부탁한 경우 recommendationsOnly=true로 호출한다. 이때 보유 상품을 빼고 예산/색 선호로 정렬한다. 명확히 특정 상품을 찾는 질문은 recommendationsOnly를 생략해서 보유한 제품이라도 찾을 수 있다. 사용자가 단지 인사했다면 검색 Tool을 자동 호출하지 않는다. shoppingMode가 travel이면 요청하지 않은 쇼핑 추천은 하지 않는다.
- searchItem: 멤버·상황(공항/무대/브이로그/팬사인회/화보/일상)·카테고리·특징 묘사로 "원래 제품(검수된 정품)"을 찾을 때. 기본적으로 대체템은 안 섞여 나온다.
- findAlternative: searchItem으로 찾은 **원래 제품이 예산을 넘을 때만** 쓴다. 검색 결과가 여러 개여도 대표 아이템 1개에 대해서만 호출한다(아이템마다 전부 부르지 않는다). 대체템을 못 찾았으면 그 사실을 한 번만 말하고, 같은 턴 안에서 "대체템을 못 찾았다"는 말을 반복하지 않는다.
- addWishlist: 사용자가 특정 아이템을 "찜", "할래", "A로 할래" 등 명확히 고를 때만 호출.
- findPlaces: 사용자가 "~가 간 곳 알려줘"처럼 성지를 물었는데 **지역을 말하지 않았을 때** 가장 먼저 쓴다. group/member만으로 전국을 한 번에 찾아서 지역별 개수로 묶어 돌려준다(예: 목포 9곳, 전주 4곳). 서울→부산→대구처럼 지역을 하나씩 추측해서 planRoute를 여러 번 부르지 않는다 — 그건 느리고 틀리기 쉽다. findPlaces로 지역별 개수를 먼저 보여주고 "어디로 짜줄까?"처럼 고르게 하거나, 사용자가 "아무 데나"/"가까운 데" 식으로 말하면 (hasFavoriteMemberVisit가 true인 지역 중, 그중) 가장 개수가 많은 지역으로 바로 planRoute를 호출한다.
- planRoute: 지역이 정해졌을 때(사용자가 말했거나, findPlaces 결과에서 골랐을 때) 실제 코스를 짠다. 이미 다녀온 곳은 자동으로 빠지고, 사용자가 찜한 아이템의 브랜드 매장이 있으면 코스에 포함돼. 같은 턴에 addWishlist도 같이 호출했다면, 방금 찜한 그 itemId를 planRoute의 itemIds에도 꼭 같이 넘겨줘 (저장 순서에 상관없이 브랜드 매장이 코스에 바로 반영되게). 사용자의 최애 멤버를 기억하고 있다면(기억 패널/메모리에 있는 그 멤버) planRoute의 member 플래그에 꼭 같이 넘겨줘 — 최애가 실제로 다녀간 성지를 코스에서 가장 먼저 넣기 위함이다. area에는 "한국"/"전국"처럼 지역 필터가 없는 값도 쓸 수 있지만, 보통은 findPlaces로 고른 지역 하나를 넣는다. "이틀 코스"/"1박 2일"처럼 여러 날이면 days에 날 수를 넣어서 **한 번만** 호출한다 (하루치씩 따로 여러 번 부르지 않는다) — 날마다 다른 장소로 자동으로 나뉘고 시간도 10~21시 안에서 짜진다.
- updateOwned: 사용자가 "샀어", "샀다", "구매했어" 처럼 실제로 구매했다고 명확히 말했을 때만 호출. 찜(위시리스트)에 있던 거면 보유로 넘어가고 위시리스트에서는 빠진다.
- markVisited: 사용자가 "다녀왔어", "갔다 왔어" 처럼 실제로 다녀왔다고 말했을 때 호출. placeIds는 대화에서 이미 planRoute로 짜줬던 코스의 placeId들을 그대로 넘긴다 (사용자가 장소 id를 직접 말하지 않아도, 방금 짜준 코스를 기억해서 넘긴다).
- 이 여덟 가지 도구가 지금 가진 전부야. 여기 없는 기능을 요청하면 지어내지 말고 솔직하게 아직 안 된다고 답해.

[정확성 — 가장 중요]
- 도구가 반환한 데이터 밖의 사실은 절대 지어내지 않는다. 검색 결과가 비어 있으면 "아직 확인되지 않은 정보예요"라고 솔직히 답하고, 손민수위키에 질문을 남겨보라고 안내한다(실제로 글을 올려주는 기능은 없고, 안내만 하는 거야 — 위키에 질문을 남기면 다른 팬이나 운영진이 찾아줄 수 있다는 뜻으로).
- 모든 아이템 추천에는 matchType으로 구분해서 말해준다: "exact"는 "원래 제품(검수됨)", "sample"은 "예시 대체템"(손민수위키 검수 데이터가 아니라 시연용 예시라 가격·재고가 정확하지 않을 수 있음을 자연스럽게 알려준다), "similar"는 "유사 제품(팬 검수)" — 이건 "정품인지는 아직 확인되지 않았고, 팬들이 비슷하다고 찾아준 제품"이라고 원래 제품과 분명히 구분해서 말해준다.
- member 값이 "단체"면 오직 같은 group에 속한 멤버에게만 적용한다. NCT WISH 단체템은 A2O LITE 아이찡 템이 절대 아니다. 어떤 경우에도 타 그룹 착용을 지어내지 않는다.
- matchType="source_only"는 X 팬 계정이 주장하는 아이템으로, 착용 사실·정품 여부·구매 가능 여부가 아직 검증되지 않았다. "팬 계정 출처(미검증)"라고 정확히 설명한다. 가격이 없으면 가격 미확인이고, X 출처 링크를 구매 링크로 소개하지 않는다. 팬 계정 수집 자료를 "검수된 정품"이라고 단정하지 않는다.
- 기억에 기반한 예산/색 추천을 했으면 구체적으로 어떤 기억을 적용했고 보유 제품이 제외됐는지 짧게 말한다. 사용자가 변경한 취향은 새 값으로 저장하고, 없던 사이즈 적합성은 확언하지 않는다.
- 팬 계정에서 수집한 X 제품의 가격은 조사 당시 기록일 뿐이며, 판매 여부나 현재 가격이 검증되지 않았음을 명시한다. X와 구매처가 모두 있으면 X는 출처, 실제 쇼핑몰 URL은 구매 링크로 구분한다.
- 멤버 이름이 여러 그룹에서 겹쳐 candidateGroups가 반환되면 그룹을 되물어보고, 타 그룹 제품을 섞어 말하지 않는다.

[표정 마커]
- 메시지 안에 :happy:, :think:, :cheer:, :sorry: 마커를 자연스럽게 섞어서 덕메의 표정을 보여준다 (아래 markerGuide 참고).
- 데이터에 없어서 "아직 확인되지 않은 정보예요"라고 답할 때는 꼭 :sorry: 를 쓴다.

[응답 길이]
- 채팅 화면에 맞게 보통 2~5문장 내로 답한다. 카드로 보여줄 아이템/코스 목록은 도구 결과가 화면에 따로 카드로 뜨니, 텍스트로 전부 나열하지 말고 요약만 해.`;

const MARKER_GUIDE =
  ":happy: 기쁠 때 (사용자가 반가운 소식을 전했거나, 좋은 걸 찾았거나, 찜을 골랐을 때도 포함). :think: 아이템/코스를 찾는 중이거나 고민할 때 (도구를 호출하기 직전/중일 때 특히). :cheer: 사용자가 실제로 템을 '샀다'거나 성지를 '다녀왔다'고 말했을 때만 — 가장 신나는 순간이니 찜 정도에는 happy를 쓰고 cheer는 아껴둔다. :sorry: 데이터에 없어서 못 찾아줬을 때(검색 결과가 비어서 '아직 확인되지 않은 정보'라고 답할 때) 미안한 표정으로.";

// 기억 저장(memory.save)은 모델이 스스로 판단해서 트리거하는 Croche 내장 기능이라, 저장 시점을
// instructions가 아니라 여기 policy로 직접 못박아둔다 — 그래야 첫 턴에 최애/사이즈/예산이 나왔을 때
// 거의 항상 바로 저장된다 (PRD §7, 시나리오 1).
const MEMORY_POLICY =
  "사용자가 최애 그룹·멤버, 예산, 사이즈(상의/하의/신발), 보유 아이템, 위시리스트, 방문한 성지, 취향 키워드, 쇼핑/성지 선호 모드, 선호 언어 중 하나라도 말하면 반드시 그 즉시(같은 턴 안에) 저장한다. 특히 대화 맨 처음에 최애·사이즈·예산이 나오면 절대 건너뛰지 않고 바로 기억한다. 외출 날짜·지역·목적처럼 그 대화에서만 쓰는 정보는 저장하지 않는다.";

const croche = await Croche.open({
  projectKey: CROCHE_PROJECT_KEY,
  // 개발용 debug key만 사용 (PRD §5). 프로덕션 배포는 이 해커톤 범위 밖(PRD §12).
  debugKey: CROCHE_DEBUG_KEY,
  user: DEMO_USER,
  storage: new FileStorage(join(here, "..", ".croche")),
  config: {
    model: "deepseek/deepseek-v4.1-flash",
    defaultLanguage: "ko", // Node SDK 기본값(en) 대신 한국어를 기본으로 설정
    instructions: INSTRUCTIONS,
    markerGuide: MARKER_GUIDE,
    tools: toolDeclarations,
    // 한 메시지에 여러 요청이 들어와 searchItem→findAlternative→addWishlist→planRoute까지
    // 한 턴에서 전부 호출해야 하는 경우가 있어, 기본값보다 넉넉하게 잡아둔다.
    maxIterations: 12,
    memory: { policy: MEMORY_POLICY },
  },
  handlers: toolHandlers,
});
const agent = await croche.agent();

// 이 데모는 방문자 전체가 하나의 대화를 공유한다 (PRD: 로그인 없는 데모 1화면).
const pages = new Set<ServerResponse>();
const sendEvent = (res: ServerResponse, payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

agent.subscribe({
  onEvent: (event: AgentEvent) => {
    for (const page of pages) sendEvent(page, { source: "agent", event });
  },
});
onCard((card) => {
  for (const page of pages) sendEvent(page, { source: "card", event: card });
});

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await readFile(join(here, "..", "public", "index.html")));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/media-preview?")) {
      const search = new URL(req.url, `http://localhost:${PORT}`).searchParams;
      const type = search.get("type");
      const id = search.get("id") ?? "";
      if ((type !== "item" && type !== "place") || id.length > 120 || !id) {
        res.writeHead(400).end();
        return;
      }
      const source = type === "item"
        ? (await loadItems()).find((i) => i.id === id)
        : (await loadPlaces()).find((p) => p.id === id);
      if (!source) { res.writeHead(404).end(); return; }
      const preview = await getMediaPreview(type, id, source);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=900" })
        .end(JSON.stringify(preview ?? { imageUrl: null }));
      return;
    }
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      pages.add(res);
      req.on("close", () => pages.delete(res));
      return;
    }
    if (req.method === "POST" && req.url === "/send") {
      const body = await readBody(req);
      const text = String(JSON.parse(body || "{}").text ?? "").trim().slice(0, 4000);
      if (!text) {
        res.writeHead(400).end();
        return;
      }
      // Croche가 대화 이력을 초기화해도 앱에 저장된 최애·예산·구매·방문 정보는
      // 매 턴 별도 context로 전달한다 (SDK SendInput.context 공식 지원).
      const [items, places] = await Promise.all([loadItems(), loadPlaces()]);
      const explicit = extractExplicitPreferences(text, items);
      // Croche가 savePreferences를 생략한 턴에도 '내 최애는 사쿠야, 예산은 5만 원'
      // 처럼 사용자가 분명히 직접 말한 사실만 앱에 안전하게 보존한다.
      if (Object.keys(explicit).length) {
        await updateState(DEMO_USER, state => {
          if (explicit.favoriteGroup && explicit.favoriteGroup !== state.preferences.favoriteGroup && !explicit.favoriteMember) {
            delete state.preferences.favoriteMember;
          }
          state.preferences = { ...state.preferences, ...explicit };
        });
      }
      const appState = await readState(DEMO_USER);
      const context = buildPersonalContext(appState, agent.memory.list(), items, places);
      const receipt = await agent.send({ id: randomUUID(), text, context });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(receipt));
      return;
    }
    if (req.method === "POST" && req.url === "/reset") {
      // "새 대화": 대화창만 비움 (기억은 유지). "기억 초기화": 대화 + AI 기억 + 찜/보유/방문 목록까지 전부 비움(시연 리셋용).
      const body = await readBody(req);
      const scope = String(JSON.parse(body || "{}").scope ?? "conversation");
      await agent.clearHistory();
      if (scope === "all") {
        await agent.memory.clear();
        await resetState(DEMO_USER);
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, scope }));
      return;
    }
    if (req.method === "POST" && req.url === "/memory/delete") {
      // 기억 패널에서 사용자가 직접 지우는 AI 기억 한 줄 (PRD §7: 패널에서 직접 수정·삭제 가능).
      // Croche 메모리 API는 삭제만 지원한다 — "수정"은 지우고 대화에서 다시 말해주는 방식으로 이어진다.
      const body = await readBody(req);
      const id = String(JSON.parse(body || "{}").id ?? "").trim();
      if (!id) {
        res.writeHead(400).end();
        return;
      }
      const outcome = await agent.memory.delete(id);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, outcome }));
      return;
    }
    if (req.method === "POST" && req.url === "/list/remove") {
      // 위시리스트/보유/방문 목록에서 한 항목을 사용자가 직접 지운다.
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}") as { list?: string; id?: string };
      const list = payload.list;
      const id = String(payload.id ?? "").trim();
      if (!id || (list !== "wishlist" && list !== "owned" && list !== "visitedPlaces")) {
        res.writeHead(400).end();
        return;
      }
      await updateState(DEMO_USER, (state) => {
        state[list] = state[list].filter((x) => x !== id);
      });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/purchase-click") {
      // 아이템 카드의 "사러 가기" 클릭 — 실제 구매 연동은 범위 밖(PRD §12)이라 외부 url로만 보내고,
      // 화면 구석 카운터용으로 클릭 수만 센다. 서버에 저장해서 새로고침해도 유지된다.
      const { purchaseClicks } = await updateState(DEMO_USER, (state) => {
        state.purchaseClicks += 1;
        return { purchaseClicks: state.purchaseClicks };
      });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ purchaseClicks }));
      return;
    }
    if (req.method === "GET" && req.url === "/state") {
      // "덕메가 기억하는 것" 패널: 자유 텍스트 기억(최애·예산·사이즈 등)은 Croche가 대화에서 알아서 적어두고,
      // 찜/보유/방문 목록은 앱이 도구 호출 때마다 authoritative하게 들고 있는다 (PRD §7).
      const memory = agent.memory.list();
      const [items, places, appState] = await Promise.all([loadItems(), loadPlaces(), readState(DEMO_USER)]);
      const wishlist = appState.wishlist.map((id) => items.find((i) => i.id === id)).filter(Boolean);
      const owned = appState.owned.map((id) => items.find((i) => i.id === id)).filter(Boolean);
      const visitedPlaces = appState.visitedPlaces.map((id) => places.find((p) => p.id === id)).filter(Boolean);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ memory, preferences: appState.preferences, wishlist, owned, visitedPlaces, purchaseClicks: appState.purchaseClicks }));
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    console.error("request failed:", error);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

server.listen(Number(PORT), HOST, () => {
  console.log(`덕메 서버: http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 와이파이: http://${ip}:${PORT}`);
});

const stop = async () => {
  server.close();
  await croche.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
