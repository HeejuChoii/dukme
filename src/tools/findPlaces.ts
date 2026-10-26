import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { loadPlaces, loadAliases, loadItems, type Place } from "../data.js";
import { emitCard, dedupeKeyFor } from "../bus.js";
import { readState } from "../state.js";
import { favoriteTargets, groupVisitIndex, memberVisitIndex } from "./favoriteTargets.js";
import { placeMatchesArea, regionBucket } from "../geo.js";

export const findPlacesDeclaration: ToolDeclaration = {
  name: "findPlaces",
  summary:
    "지역 없이 그룹·멤버만으로 전국 성지를 한 번에 찾는다. 결과는 지역별 개수로 묶여서 나온다 (예: 목포 9곳, 전주 4곳). " +
    "'~가 간 곳 알려줘' 처럼 지역을 안 말했을 때, 서울/부산 등을 하나씩 찔러보지 말고 반드시 이 도구부터 쓴다.",
  commands: [
    {
      key: "find_places",
      name: "find",
      reads: true,
      summary:
        "group/member로 전국 성지를 찾아 지역별 개수로 묶어 반환한다. area를 주면 그 지역에서만 센다(보통 안 줘도 됨). " +
        "이 결과로 지역 하나를 고른 뒤 planRoute를 호출해서 실제 코스를 짠다 — 지역을 추측해서 planRoute를 여러 번 부르지 않는다.",
      flags: [
        { name: "group", type: "string", description: "그룹명. 한글 정식 이름/별명 모두 가능 (예: NCT WISH, 위시)" },
        { name: "member", type: "string", description: "멤버명. 한글 정식 이름/별명 모두 가능 (예: 시온, 오시온)" },
        { name: "area", type: "string", description: "특정 지역으로만 좁히고 싶을 때만 (보통 생략)" },
      ],
    },
  ],
};

export const findPlacesHandler: ToolHandler = async (invocation, context) => {
  if (invocation.key !== "find_places") {
    return { status: "rejected", reason: "알 수 없는 동작이에요." };
  }
  const args = invocation.args as Record<string, unknown>;
  const area = String(args.area ?? "").trim();

  const [places, aliases, items, state] = await Promise.all([loadPlaces(), loadAliases(), loadItems(), readState(context.user ?? "demo-user")]);

  // 멤버·그룹을 말했으면 그 하나, 아니면 저장된 최애 전체(앞 순서 우선)로 찾는다.
  const { targets, fromSaved } = favoriteTargets(args, state.preferences.favorites, items, aliases);
  if (!targets.length) {
    return { status: "rejected", reason: "group이나 member 중 하나는 있어야 해요. (저장된 최애도 없어요)" };
  }
  const memberVisitMatch = (place: Place) => memberVisitIndex(place, targets, aliases) >= 0;
  // 멤버를 정한 대상은 그 멤버(또는 그 그룹 단체)가 다녀간 곳만, 그룹만 정한 대상은 그 그룹이 다녀간 곳.
  const targetMatch = (place: Place) => targets.some((t) =>
    t.member
      ? memberVisitIndex(place, [t], aliases) >= 0 && (!t.group || groupVisitIndex(place, [t], aliases) >= 0)
      : groupVisitIndex(place, [t], aliases) >= 0);

  const matched = places
    .filter((place) => placeMatchesArea(place, area))
    .filter(targetMatch);

  const buckets = new Map<string, { region: string; count: number; hasFavoriteMemberVisit: boolean; placeIds: string[] }>();
  for (const place of matched) {
    const region = regionBucket(place);
    const bucket = buckets.get(region) ?? { region, count: 0, hasFavoriteMemberVisit: false, placeIds: [] };
    bucket.count += 1;
    bucket.placeIds.push(place.id);
    if (memberVisitMatch(place)) bucket.hasFavoriteMemberVisit = true;
    buckets.set(region, bucket);
  }

  const regions = Array.from(buckets.values()).sort((a, b) => {
    if (a.hasFavoriteMemberVisit !== b.hasFavoriteMemberVisit) return a.hasFavoriteMemberVisit ? -1 : 1;
    return b.count - a.count;
  });

  const result = {
    query: { group: typeof args.group === "string" ? args.group : null, member: typeof args.member === "string" ? args.member : null, area: area || null },
    ...(fromSaved ? { usedSavedFavorites: targets.map((t) => [t.group, t.memberName ?? t.member].filter(Boolean).join(" ")) } : {}),
    totalCount: matched.length,
    regionCount: regions.length,
    regions: regions.map((r) => ({ region: r.region, count: r.count, hasFavoriteMemberVisit: r.hasFavoriteMemberVisit })),
  };
  emitCard({ tool: "findPlaces", data: result }, dedupeKeyFor("findPlaces", invocation.key, args, context.causedBy));
  return result as unknown as JsonValue;
};
