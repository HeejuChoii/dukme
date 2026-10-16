// Area/region matching for places. "대구" (Daegu) is a literal substring of "해운대구"
// (Haeundae-gu, a district of Busan) — plain substring matching on area names picks up
// the wrong city. So we compare whole administrative tokens (province, district), with
// known suffixes stripped, instead of raw substring containment.
import type { Place } from "./data.js";
import { norm } from "./aliasMatch.js";

const ADMIN_SUFFIX = /(특별자치시|특별자치도|특별시|광역시|자치시|자치군|도|시|군|구)$/;

function stripAdminSuffix(token: string): string {
  return token.replace(ADMIN_SUFFIX, "");
}

// 행정 명칭이 아닌 동네 별명. 접미사만 떼어서는 알 수 없는 것들만 넣는다
// (서울/경기/부산 같은 시·도 단위는 접미사 제거만으로 이미 매치된다).
const AREA_ALIASES: Record<string, string> = {
  홍대: "마포구",
  성수: "성동구",
  한남: "용산구",
  강남: "강남구",
};

function regionTokens(place: Place): { province: string; district: string } {
  const parts = (place.region || "").trim().split(/\s+/);
  return { province: parts[0] || "", district: parts[1] || place.area || "" };
}

export function placeMatchesArea(place: Place, rawQuery: string | undefined | null): boolean {
  const query = norm(rawQuery);
  if (!query || query === "한국" || query === "전국") return true;

  const { province, district } = regionTokens(place);
  const candidates = new Set(
    [province, stripAdminSuffix(province), district, stripAdminSuffix(district), place.area].map(norm),
  );
  if (candidates.has(query)) return true;

  const aliasTarget = AREA_ALIASES[(rawQuery ?? "").trim()];
  if (aliasTarget && candidates.has(norm(aliasTarget))) return true;

  return false;
}

// 전국 결과를 묶어서 보여줄 때 쓰는 지역 단위: 광역시/도는 짧은 이름("서울","부산"),
// 그 밖의 시·군(목포시, 강릉시 등)은 그 자체(접미사만 뗀) 이름을 쓴다.
export function regionBucket(place: Place): string {
  const { province, district } = regionTokens(place);
  if (/구$/.test(place.area)) {
    const short = stripAdminSuffix(province);
    return short || province || place.area;
  }
  const short = stripAdminSuffix(district || place.area);
  return short || district || place.area;
}
