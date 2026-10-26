// 최애 그룹·멤버 판별 공통 로직. explicitPreferences(문장에서 직접 추출)와 savePreferences Tool이
// 같은 규칙을 쓰도록 한 곳에 모은다. 그룹·멤버 소속은 data/items.json, 별명은 data/aliases.json 기준.
// - 멤버만 말해도 데이터에서 그룹을 찾는다. 그룹이 하나면 그룹까지 같이 정하고, 여러 그룹이면 정하지 않는다.
// - 그룹명은 "아이브", "엔시티 위시", "위시" 같은 한글 표기·별명도 정식 이름으로 맞춘다.
import type { Aliases, Item } from "./data.js";
import type { FanPreferences } from "./state.js";
import { norm } from "./aliasMatch.js";

export interface FavoriteCatalog {
  groups: Array<{ name: string; variants: string[] }>; // variants: 공백 없앤 소문자
  members: Array<{ group: string; name: string; variants: string[] }>;
}

export type FavoriteResolution =
  | { status: "resolved"; favoriteGroup?: string; favoriteMember?: string }
  | { status: "ambiguous"; member: string; candidateGroups: string[] }
  | { status: "none" };

const compact = (value: string) => norm(value).replace(/\s+/g, "");

// "장원영"을 "원영"으로도 부르니까, 흔한 성으로 시작하는 세 글자 한글 이름은 이름 두 글자도 받는다.
// ("아이유"→"이유", "카리나"→"리나"처럼 성이 아닌 경우는 만들지 않는다.)
const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나명";
function givenName(name: string): string | null {
  return /^[가-힣]{3}$/.test(name) && SURNAMES.includes(name[0]!) ? name.slice(1) : null;
}

export function buildFavoriteCatalog(items: Item[], aliases: Aliases): FavoriteCatalog {
  const itemGroups = [...new Set(items.map((i) => i.group))].filter((g) => g && g !== "단체");
  const groupAliasKeys = Object.keys(aliases.groups ?? {});
  const groups = new Map<string, Set<string>>();
  const addGroup = (name: string, variants: string[]) => {
    const set = groups.get(name) ?? new Set<string>();
    for (const v of [name, ...variants]) if (compact(v)) set.add(compact(v));
    groups.set(name, set);
  };
  for (const g of itemGroups) addGroup(g, []);
  for (const key of groupAliasKeys) {
    const variants = aliases.groups[key] ?? [];
    // 별명 키 이름이 items와 다를 수 있다(SVT ↔ SEVENTEEN) — 별명 중 하나가 items 그룹명과 같으면 그쪽으로 합친다.
    const canonical = itemGroups.find((g) => [key, ...variants].some((v) => compact(v) === compact(g))) ?? key;
    addGroup(canonical, [key, ...variants]);
  }

  const memberAliasKeys = Object.keys(aliases.members ?? {});
  const members: FavoriteCatalog["members"] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.member || item.member === "단체" || !item.group || item.group === "단체") continue;
    const id = `${item.group}\u0000${item.member}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const variants = new Set<string>([compact(item.member)]);
    const given = givenName(item.member);
    if (given) variants.add(given);
    // 별명 키가 성까지 붙은 이름일 수 있다("명재현" ↔ items의 "재현").
    for (const key of memberAliasKeys) {
      if (key === item.member || givenName(key) === item.member || given === key) {
        for (const v of [key, ...(aliases.members[key] ?? [])]) if (compact(v)) variants.add(compact(v));
      }
    }
    members.push({ group: item.group, name: item.member, variants: [...variants] });
  }
  return { groups: [...groups].map(([name, variants]) => ({ name, variants: [...variants] })), members };
}

/** 그룹 이름·별명을 정식 그룹명으로. 모르는 그룹이면 null. */
export function canonicalGroup(input: string, catalog: FavoriteCatalog): string | null {
  const key = compact(input);
  if (!key) return null;
  return catalog.groups.find((g) => g.variants.includes(key))?.name ?? null;
}

/** 멤버 이름·별명이 데이터에서 속한 (그룹, 정식 멤버명) 목록. */
export function findMember(input: string, catalog: FavoriteCatalog, group?: string): Array<{ group: string; name: string }> {
  const key = compact(input);
  if (!key) return [];
  return catalog.members
    .filter((m) => (!group || m.group === group) && m.variants.includes(key))
    .map(({ group: g, name }) => ({ group: g, name }));
}

/**
 * savePreferences처럼 그룹·멤버가 따로 들어올 때. 멤버가 데이터에 있으면 데이터의 그룹을 따른다
 * (모델이 예전 최애 그룹을 그대로 붙여 보내도 바로잡힌다). 같은 이름이 여러 그룹에 있고 그룹이
 * 정해지지 않으면 ambiguous로 돌려서 덕메가 되묻게 한다.
 */
export function resolveFavorite(input: { group?: string; member?: string }, catalog: FavoriteCatalog): FavoriteResolution {
  const groupText = input.group?.trim() ?? "";
  const memberText = input.member?.trim() ?? "";
  const group = groupText ? canonicalGroup(groupText, catalog) ?? groupText : undefined;
  if (!memberText) return group ? { status: "resolved", favoriteGroup: group } : { status: "none" };

  if (group) {
    const inGroup = findMember(memberText, catalog, group);
    if (inGroup.length) return { status: "resolved", favoriteGroup: group, favoriteMember: inGroup[0]!.name };
  }
  const matches = findMember(memberText, catalog);
  const groups = [...new Set(matches.map((m) => m.group))];
  if (groups.length === 1) return { status: "resolved", favoriteGroup: groups[0], favoriteMember: matches[0]!.name };
  if (groups.length > 1) return { status: "ambiguous", member: memberText, candidateGroups: groups };
  // 데이터에 없는 멤버: 사용자가 말한 그대로 저장한다. 그룹을 말했으면 그 그룹을 같이.
  return group ? { status: "resolved", favoriteGroup: group, favoriteMember: memberText } : { status: "resolved", favoriteMember: memberText };
}

// 한국어 조사·어미를 떼고 이름 후보를 만든다: "사쿠야야" → "사쿠야", "원영이" → "원영".
const PARTICLES = ["이에요", "예요", "에요", "이야", "이랑", "이가", "이는", "이를", "이도", "님", "야", "이", "가", "는", "은", "을", "를", "도", "랑", "의"];
function tokenCandidates(token: string): string[] {
  const out = new Set([token]);
  for (const p of PARTICLES) if (token.length > p.length && token.endsWith(p)) out.add(token.slice(0, -p.length));
  return [...out];
}

/** "내 최애는 사쿠야야", "나 원영이 최애야", "최애 그룹은 아이브"처럼 문장에서 최애를 찾는다. */
export function detectFavoriteInText(text: string, catalog: FavoriteCatalog): FavoriteResolution {
  // "위시리스트"의 "위시"를 NCT WISH로 읽지 않게 먼저 지운다.
  const cleaned = norm(text).replace(/위시\s*리스트|wish\s*list/g, " ");
  const flat = cleaned.replace(/\s+/g, "");
  // 두 글자 이하 별명은 단어 단위로만 맞춘다("레벨" 같은 일반어 오인 방지).
  const rawTokens = cleaned.split(/[\s.,!?~'"()\[\]/]+/).filter(Boolean);
  const tokenSet = new Set(rawTokens.flatMap(tokenCandidates));
  // 한 글자 이름("한", "뷔")은 "한 번"처럼 일반 단어와 겹치니, 조사가 붙었을 때("뷔야", "한이")만 이름으로 본다.
  const withParticle = new Set(rawTokens.flatMap((t) => tokenCandidates(t).filter((c) => c !== t)));
  const mentioned = (v: string) => (v.length >= 3 ? flat.includes(v) : tokenSet.has(v));

  const groups = catalog.groups.filter((g) => g.variants.some(mentioned)).map((g) => g.name);
  if (groups.length > 1) return { status: "none" }; // 그룹을 여러 개 말했으면 하나로 정하지 않는다

  const memberMentioned = (m: FavoriteCatalog["members"][number]) =>
    m.variants.some((v) => (v.length === 1 && !groups.length ? withParticle.has(v) : tokenSet.has(v)) || (v.length >= 3 && flat.includes(v)));
  const pool = groups.length === 1 ? catalog.members.filter((m) => m.group === groups[0]) : catalog.members;
  const hits = pool.filter(memberMentioned);
  const names = [...new Set(hits.map((m) => m.name))];

  if (groups.length === 1) {
    return names.length === 1
      ? { status: "resolved", favoriteGroup: groups[0], favoriteMember: names[0] }
      : { status: "resolved", favoriteGroup: groups[0] };
  }
  if (names.length !== 1) return { status: "none" };
  const hitGroups = [...new Set(hits.map((m) => m.group))];
  if (hitGroups.length === 1) return { status: "resolved", favoriteGroup: hitGroups[0], favoriteMember: names[0] };
  return { status: "ambiguous", member: names[0]!, candidateGroups: hitGroups };
}

/**
 * 저장된 선호에 최애 변경을 병합한다 (server.ts의 직접 추출 경로와 savePreferences Tool 공통).
 * - 그룹+멤버가 같이 오면 둘 다 덮어쓴다(예전 그룹이 남지 않는다).
 * - 그룹만 바뀌면, 저장된 멤버가 새 그룹 데이터에 없을 때 멤버를 지운다.
 * - 멤버만 오면(데이터에 없는 멤버), 저장된 그룹 데이터에 그 멤버가 없을 때 그룹을 지운다.
 */
export function mergeFavorite(preferences: FanPreferences, change: { favoriteGroup?: string; favoriteMember?: string }, catalog: FavoriteCatalog): FanPreferences {
  const next = { ...preferences };
  if (change.favoriteGroup && change.favoriteMember) {
    next.favoriteGroup = change.favoriteGroup;
    next.favoriteMember = change.favoriteMember;
  } else if (change.favoriteGroup) {
    if (change.favoriteGroup !== next.favoriteGroup && next.favoriteMember && !findMember(next.favoriteMember, catalog, change.favoriteGroup).length) {
      delete next.favoriteMember;
    }
    next.favoriteGroup = change.favoriteGroup;
  } else if (change.favoriteMember) {
    if (next.favoriteGroup && !findMember(change.favoriteMember, catalog, next.favoriteGroup).length) delete next.favoriteGroup;
    next.favoriteMember = change.favoriteMember;
  }
  return next;
}

/** 매 턴 context에 넣을 짧은 명단: "그룹: 멤버, 멤버". */
export function rosterSummary(catalog: FavoriteCatalog): string[] {
  const byGroup = new Map<string, string[]>();
  for (const m of catalog.members) byGroup.set(m.group, [...(byGroup.get(m.group) ?? []), m.name]);
  return [...byGroup].map(([g, ms]) => `${g}: ${ms.join(", ")}`);
}
