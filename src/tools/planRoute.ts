import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { loadItems, loadPlaces, loadAliases, type Place } from "../data.js";
import { readState } from "../state.js";
import { emitCard } from "../bus.js";
import { norm, fieldMatches, resolveGroupAlias } from "../aliasMatch.js";
import { placeMatchesArea } from "../geo.js";

function mustTryLabel(place: Place): string {
  const group = place.visits.find((v) => v.group)?.group;
  return group ? `${group} 픽` : "추천 메뉴";
}

export const planRouteDeclaration: ToolDeclaration = {
  name: "planRoute",
  summary:
    "지역·날짜·시간대로 성지(다녀간 장소) 코스를 짠다. 이미 다녀온 곳은 제외하고, 사용자가 찜/보유한 아이템의 브랜드 매장이 그 지역에 있으면 코스에 넣는다.",
  commands: [
    {
      key: "plan_route",
      name: "plan",
      reads: true,
      summary: "area(지역)로 성지 코스를 짠다. date/startTime은 참고용이고, 이미 방문한 곳은 자동으로 빠진다.",
      flags: [
        { name: "area", type: "string", required: true, description: "지역 (예: 홍대, 성수)" },
        { name: "date", type: "string", description: "날짜 (예: 2026-10-24). 참고용, 영업시간 검증에는 쓰지 않음" },
        { name: "startTime", type: "string", description: "시작 시각 HH:MM (예: 14:00). 생략 시 14:00" },
        { name: "maxStops", type: "integer", minimum: 1, maximum: 6, description: "최대 코스 수 (기본 4)" },
        {
          name: "itemIds",
          type: "string",
          list: true,
          description:
            "같은 턴에 사용자가 방금 찜/구매한 아이템의 id가 있으면 같이 넘긴다. 저장 타이밍에 의존하지 않고 그 브랜드 매장을 코스에 바로 반영하기 위함.",
        },
        {
          name: "member",
          type: "string",
          description:
            "사용자의 최애 멤버 (기억하고 있다면 넘긴다). 그 멤버가 실제로 다녀간 성지를 코스에서 가장 먼저 넣는다.",
        },
        {
          name: "group",
          type: "string",
          description: "사용자의 최애 그룹 (member만 알아도 됨, 그룹은 자동으로 알아낸다). 같은 그룹 멤버가 다녀간 곳을 그 다음 우선순위로 넣는다.",
        },
      ],
    },
  ],
};

const TYPE_PRIORITY = ["카페", "매장", "포토스팟", "식당"];
function typeRank(type: string): number {
  const i = TYPE_PRIORITY.indexOf(type);
  return i === -1 ? TYPE_PRIORITY.length : i; // 목록에 없는 타입(명소/한식/해변 등 실제 데이터의 다양한 타입)은 맨 뒤로, 맨 앞으로 새치기하지 않게
}

function parseStartMinutes(startTime: unknown): number {
  const text = typeof startTime === "string" ? startTime.trim() : "";
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return 14 * 60; // default 14:00
  const hour = Math.min(23, Number(match[1]));
  const minute = Math.min(59, Number(match[2]));
  return hour * 60 + minute;
}

function formatMinutes(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export const planRouteHandler: ToolHandler = async (invocation, context) => {
  if (invocation.key !== "plan_route") {
    return { status: "rejected", reason: "알 수 없는 동작이에요." };
  }
  const args = invocation.args as Record<string, unknown>;
  const area = String(args.area ?? "").trim();
  if (!area) return { status: "rejected", reason: "area(지역)가 필요해요." };
  const date = typeof args.date === "string" ? args.date : null;
  const maxStops = typeof args.maxStops === "number" ? Math.min(6, Math.max(1, args.maxStops)) : 4;
  const startMinutes = parseStartMinutes(args.startTime);

  const user = context.user ?? "demo-user";
  const [places, items, state, aliases] = await Promise.all([loadPlaces(), loadItems(), readState(user), loadAliases()]);

  const areaPlaces = places.filter((place) => placeMatchesArea(place, area));
  if (areaPlaces.length === 0) {
    const result = { status: "no_data", area, reason: `'${area}' 지역의 성지 정보는 아직 확인되지 않은 정보예요.`, course: [] as unknown[] };
    emitCard({ tool: "planRoute", data: result });
    return result as unknown as JsonValue;
  }

  const unvisited = areaPlaces.filter((place) => !state.visitedPlaces.includes(place.id));

  // Brands the user has shown interest in: wishlist/owned from the authoritative store, plus any
  // itemIds the model passes directly for this same turn (addWishlist's write may not have landed
  // yet if both tools are called in the same round — this flag makes the result independent of that).
  const explicitItemIds = Array.isArray(args.itemIds) ? (args.itemIds as unknown[]).map(String) : [];
  const interestingIds = new Set([...state.wishlist, ...state.owned, ...explicitItemIds]);
  const interestingBrands = new Set(
    items.filter((item) => interestingIds.has(item.id)).map((item) => item.brand),
  );
  const isBrandMatch = (place: Place): boolean =>
    place.type === "매장" && Array.from(interestingBrands).some((brand) => place.name.includes(brand) || place.note.includes(brand));

  // 우선순위: ① 최애 멤버가 실제로 다녀간 곳(단체 방문도 그룹이 맞으면 포함) ② 같은 그룹 멤버가 다녀간 곳
  // ③ 성지(isFandomSpot)이거나 착용 브랜드 매장 ④ 그 외 일반 명소(자리가 남을 때만).
  let favoriteMember = norm(args.member as string | undefined);
  let favoriteGroupArg = norm(args.group as string | undefined);
  // "위시"처럼 그룹 별명을 member 자리에 넣는 경우가 있어서, 실제 멤버로 안 풀리면 그룹 별명인지 먼저 확인한다.
  if (favoriteMember && !items.some((item) => fieldMatches(item.member, favoriteMember, aliases.members))) {
    const asGroup = resolveGroupAlias(favoriteMember, aliases.groups);
    if (asGroup) {
      favoriteGroupArg = favoriteGroupArg || norm(asGroup);
      favoriteMember = "";
    }
  }
  const favoriteGroup =
    favoriteGroupArg ||
    (favoriteMember ? norm(items.find((item) => fieldMatches(item.member, favoriteMember, aliases.members))?.group) : "");

  const groupVisitMatch = (place: Place): boolean =>
    Boolean(favoriteGroup) && place.visits.some((v) => fieldMatches(v.group, favoriteGroup, aliases.groups));
  const memberVisitMatch = (place: Place): boolean =>
    Boolean(favoriteMember) &&
    place.visits.some((v) =>
      v.member === "단체" ? Boolean(favoriteGroup) && fieldMatches(v.group, favoriteGroup, aliases.groups) : fieldMatches(v.member, favoriteMember, aliases.members),
    );

  const visitScore = (place: Place): number => {
    if (memberVisitMatch(place)) return 4;
    if (groupVisitMatch(place)) return 3;
    if (place.isFandomSpot || isBrandMatch(place)) return 2;
    return 1;
  };

  const ranked = [...unvisited].sort((a, b) => {
    const scoreDiff = visitScore(b) - visitScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return typeRank(a.type) - typeRank(b.type);
  });

  const chosen = ranked.slice(0, maxStops);
  const course = chosen.map((place, index) => ({
    time: formatMinutes(startMinutes + index * 90),
    placeId: place.id,
    name: place.name,
    area: place.area,
    type: place.type,
    address: place.address,
    openHours: place.openHours,
    note: place.note,
    visits: place.visits,
    isFandomSpot: place.isFandomSpot,
    isBrandMatch: isBrandMatch(place),
    isFavoriteMemberVisit: memberVisitMatch(place),
    isFavoriteGroupVisit: !memberVisitMatch(place) && groupVisitMatch(place),
    mustTry: place.mustTry,
    mustTryLabel: mustTryLabel(place),
    tip: place.tip,
    lat: place.lat,
    lng: place.lng,
    naverMapUrl: place.naverMapUrl,
    recreeUrl: place.recreeUrl,
  }));

  const excludedVisited = areaPlaces.length - unvisited.length;
  const result = {
    area,
    date,
    startTime: formatMinutes(startMinutes),
    excludedAlreadyVisited: excludedVisited,
    count: course.length,
    course,
  };
  emitCard({ tool: "planRoute", data: result });
  return result as unknown as JsonValue;
};
