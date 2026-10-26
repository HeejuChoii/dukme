// planRoute·findPlaces 공통: 이번 호출에서 "최애"로 볼 대상 목록.
// 사용자가 멤버·그룹을 말했으면(Tool 인자) 그 하나, 아니면 저장된 최애 전체(앞 순서 우선).
import type { Aliases, Item, Place } from "../data.js";
import type { FavoriteEntry } from "../state.js";
import { norm, fieldMatches, resolveGroupAlias } from "../aliasMatch.js";

export interface FavoriteTarget {
  member: string; // 소문자 정규화, 없으면 ""
  group: string; // 소문자 정규화, 없으면 ""
  memberName: string | null; // 라벨용 데이터 정식 이름
}

export function favoriteTargets(
  args: { member?: unknown; group?: unknown },
  saved: FavoriteEntry[] | undefined,
  items: Item[],
  aliases: Aliases,
): { targets: FavoriteTarget[]; fromSaved: boolean } {
  const toTarget = (memberText: string, groupText: string): FavoriteTarget | null => {
    let member = norm(memberText);
    let group = norm(groupText);
    // "위시"처럼 그룹 별명을 member 자리에 넣는 경우가 있어서, 실제 멤버로 안 풀리면 그룹 별명인지 먼저 확인한다.
    if (member && !items.some((item) => fieldMatches(item.member, member, aliases.members))) {
      const asGroup = resolveGroupAlias(member, aliases.groups);
      if (asGroup) {
        group = group || norm(asGroup);
        member = "";
      }
    }
    const memberItem = member
      ? items.find((item) => item.member !== "단체" && fieldMatches(item.member, member, aliases.members) && (!group || fieldMatches(item.group, group, aliases.groups)))
      : undefined;
    if (!group && memberItem) group = norm(memberItem.group);
    if (!member && !group) return null;
    return { member, group, memberName: memberItem?.member ?? null };
  };

  const argMember = typeof args.member === "string" ? args.member : "";
  const argGroup = typeof args.group === "string" ? args.group : "";
  if (argMember.trim() || argGroup.trim()) {
    const one = toTarget(argMember, argGroup);
    return { targets: one ? [one] : [], fromSaved: false };
  }
  const targets = (saved ?? []).map((f) => toTarget(f.member ?? "", f.group ?? "")).filter((t): t is FavoriteTarget => t !== null);
  return { targets, fromSaved: targets.length > 0 };
}

/** 이 장소에 다녀간 최애 멤버(단체 방문은 그룹이 맞으면 포함) 중 가장 앞 순서의 index, 없으면 -1. */
export function memberVisitIndex(place: Place, targets: FavoriteTarget[], aliases: Aliases): number {
  return targets.findIndex((t) =>
    Boolean(t.member) &&
    place.visits.some((v) =>
      v.member === "단체" ? Boolean(t.group) && fieldMatches(v.group, t.group, aliases.groups) : fieldMatches(v.member, t.member, aliases.members),
    ),
  );
}

/** 이 장소에 다녀간 최애 그룹 중 가장 앞 순서의 index, 없으면 -1. */
export function groupVisitIndex(place: Place, targets: FavoriteTarget[], aliases: Aliases): number {
  return targets.findIndex((t) => Boolean(t.group) && place.visits.some((v) => fieldMatches(v.group, t.group, aliases.groups)));
}
