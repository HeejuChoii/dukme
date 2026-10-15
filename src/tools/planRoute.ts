import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { loadItems, loadPlaces, type Place } from "../data.js";
import { readState } from "../state.js";
import { emitCard } from "../bus.js";

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
      ],
    },
  ],
};

const TYPE_PRIORITY = ["카페", "매장", "포토스팟", "식당"];

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
  const [places, items, state] = await Promise.all([loadPlaces(), loadItems(), readState(user)]);

  const areaPlaces = places.filter((place) => place.area.includes(area) || area.includes(place.area));
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

  const ranked = [...unvisited].sort((a, b) => {
    const brandDiff = Number(isBrandMatch(b)) - Number(isBrandMatch(a));
    if (brandDiff !== 0) return brandDiff;
    return TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type);
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
    isBrandMatch: isBrandMatch(place),
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
