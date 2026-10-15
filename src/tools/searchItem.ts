import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { loadItems, type Item } from "../data.js";
import { emitCard } from "../bus.js";

export const searchItemDeclaration: ToolDeclaration = {
  name: "searchItem",
  summary:
    "최애 멤버가 착용한 '원래 제품(검수된 정품)'을 멤버·상황·날짜·특징 묘사로 찾는다. '공항에서 멘 가방', '빨간 니트' 같은 모호한 표현도 처리한다. 대체템은 여기서 섞여 나오지 않으니, 예산 안의 대체템이 필요하면 결과의 itemId로 findAlternative를 따로 호출한다. data/items.json에 없는 건 지어내지 않는다.",
  commands: [
    {
      key: "search_item",
      name: "search",
      reads: true,
      summary:
        "member·group·situation·category·keywords 중 아는 조건만 넣어서 '원래 제품'을 찾는다 (대체템은 기본적으로 빠짐 — includeAlternatives:true를 주지 않으면 원래 제품만 나온다). 결과가 없으면 빈 배열을 반환하니, 그대로 '아직 확인되지 않은 정보'라고 답한다.",
      flags: [
        { name: "group", type: "string", description: "그룹명 (예: NCT WISH, Stray Kids)" },
        { name: "member", type: "string", description: "멤버명, 한글 또는 로마자 모두 가능 (예: 리쿠, riku)" },
        {
          name: "situation",
          type: "string",
          description: "상황 (공항 / 무대 / 브이로그 / 팬사인회 / 화보 / 일상 중 하나)",
        },
        { name: "category", type: "string", description: "카테고리 (가방, 모자, 신발 등)" },
        {
          name: "keywords",
          type: "string",
          description: "자유 텍스트 특징 묘사 (예: 블랙 숄더백, 은색 버클, 빨간 니트)",
        },
        {
          name: "includeAlternatives",
          type: "boolean",
          description: "true면 대체템도 섞어서 반환. 기본 false(원래 제품만). 예산 안의 대체템은 findAlternative를 쓰는 게 맞다.",
        },
        { name: "limit", type: "integer", description: "최대 결과 수", minimum: 1, maximum: 20 },
      ],
    },
  ],
};

function norm(value: string | undefined | null): string {
  return (value ?? "").toString().trim().toLowerCase();
}

// Members are sometimes named by their romanized stage name (the model may write "riku" for
// "리쿠"). Korean substring matching alone misses that, so alias it explicitly.
const MEMBER_ALIASES: Record<string, string[]> = {
  리쿠: ["riku"],
  유우: ["yu", "yuu"],
  사쿠야: ["sakuya"],
  켄: ["ken"],
  시온: ["sion", "shion"],
  신유: ["shinyu", "sinyu"],
  소운: ["soul", "soun"],
  현진: ["hyunjin"],
  필릭스: ["felix"],
  방찬: ["bangchan", "chan"],
  한: ["han"],
  아이엔: ["i.n", "in", "ien"],
};

function memberMatches(itemMember: string, filter: string): boolean {
  if (!filter) return true;
  if (norm(itemMember).includes(filter)) return true;
  const aliases = MEMBER_ALIASES[itemMember] ?? [];
  return aliases.some((alias) => alias === filter || alias.includes(filter) || filter.includes(alias));
}

function matches(item: Item, text: string): boolean {
  if (!text) return true;
  const haystack = `${item.group} ${item.member} ${item.situation} ${item.category} ${item.brand} ${item.name} ${item.features}`.toLowerCase();
  return text
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => haystack.includes(token));
}

export const searchItemHandler: ToolHandler = async (invocation) => {
  if (invocation.key !== "search_item") {
    return { status: "rejected", reason: "알 수 없는 동작이에요." };
  }
  const args = invocation.args as Record<string, unknown>;
  const group = norm(args.group as string | undefined);
  const member = norm(args.member as string | undefined);
  const situation = norm(args.situation as string | undefined);
  const category = norm(args.category as string | undefined);
  const keywords = norm(args.keywords as string | undefined);
  const includeAlternatives = args.includeAlternatives === true;
  const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 10;

  const items = await loadItems();
  const results = items
    .filter((item) => includeAlternatives || item.isOriginal)
    .filter((item) => !group || norm(item.group).includes(group))
    .filter((item) => memberMatches(item.member, member))
    .filter((item) => !situation || norm(item.situation).includes(situation))
    .filter((item) => !category || norm(item.category).includes(category))
    .filter((item) => matches(item, keywords))
    .sort((a, b) => {
      if (a.isOriginal !== b.isOriginal) return a.isOriginal ? -1 : 1;
      return b.date.localeCompare(a.date);
    })
    .slice(0, limit);

  const result = {
    query: { group: group || null, member: member || null, situation: situation || null, category: category || null, keywords: keywords || null },
    count: results.length,
    results,
  };
  emitCard({ tool: "searchItem", data: result });
  return result as unknown as JsonValue;
};
