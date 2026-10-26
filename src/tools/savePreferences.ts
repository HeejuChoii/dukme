import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { updateState, type FanPreferences } from "../state.js";
import { loadAliases, loadItems } from "../data.js";
import { buildFavoriteCatalog, mergeFavorite, resolveFavorite } from "../favorite.js";

export const savePreferencesDeclaration: ToolDeclaration = {
  name: "savePreferences",
  summary: "대화에서 사용자가 직접 밝힌 최애·예산·색·사이즈·쇼핑/성지 모드를 구조화해 저장한다. 재방문 후 추천 Tool이 실제로 이 값을 적용할 수 있게 한다.",
  commands: [{
    key: "save_preferences", name: "save", reads: false,
    summary: "사용자가 명시적으로 이야기하거나 변경한 항목만 전송한다. 모르는 값은 추측하지 않는다.",
    flags: [
      { name: "favoriteGroup", type: "string", description: "최애 그룹의 정식 이름" },
      { name: "favoriteMember", type: "string", description: "최애 멤버. 그룹을 몰라도 멤버만 보내면 앱 데이터에서 그룹을 찾아 같이 저장한다" },
      { name: "budget", type: "integer", minimum: 0, description: "현재 쇼핑 예산(원)" },
      { name: "colors", type: "string", description: "좋아하는 색상 목록, 쉼표 구분" },
      { name: "sizeTop", type: "string", description: "상의 사이즈" },
      { name: "sizeBottom", type: "string", description: "하의 사이즈" },
      { name: "sizeShoes", type: "string", description: "신발 사이즈" },
      { name: "shoppingMode", type: "string", description: "shopping(쇼핑), travel(성지), both(둘 다) 중 하나" },
      { name: "language", type: "string", description: "사용자가 명시한 선호 응답 언어: ko, en, ja, zh-CN(간체), zh-TW(번체)" },
    ],
  }],
};

export const savePreferencesHandler: ToolHandler = async (invocation, context) => {
  if (invocation.key !== "save_preferences") return { status: "rejected", reason: "지원하지 않는 동작" };
  const a = invocation.args as Record<string, unknown>;
  const changes: FanPreferences = {};
  for (const key of ["sizeTop", "sizeBottom", "sizeShoes"] as const) {
    if (typeof a[key] === "string" && a[key].trim()) changes[key] = a[key].trim().slice(0,80);
  }
  if (typeof a.budget === "number" && Number.isSafeInteger(a.budget) && a.budget >= 0 && a.budget <= 100000000) changes.budget = a.budget;
  if (typeof a.colors === "string" && a.colors.trim()) {
    changes.colors = a.colors.split(/[,，/]/).map(v => v.trim()).filter(Boolean).slice(0,8);
  }
  if (a.shoppingMode === "shopping" || a.shoppingMode === "travel" || a.shoppingMode === "both") changes.shoppingMode = a.shoppingMode;
  if (["ko", "en", "ja", "zh-CN", "zh-TW"].includes(String(a.language))) changes.language = a.language as "ko" | "en" | "ja" | "zh-CN" | "zh-TW";
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : undefined);
  const [items, aliases] = await Promise.all([loadItems(), loadAliases()]);
  const catalog = buildFavoriteCatalog(items, aliases);
  const favorite = resolveFavorite({ group: text(a.favoriteGroup), member: text(a.favoriteMember) }, catalog);
  if (favorite.status === "ambiguous" && !Object.keys(changes).length) {
    return { status: "needs_group", member: favorite.member, candidateGroups: favorite.candidateGroups,
      reason: "같은 이름의 멤버가 여러 그룹에 있어 최애를 저장하지 않았다. candidateGroups 중 어느 그룹인지 사용자에게 물어본다." } as unknown as JsonValue;
  }
  const favoriteChange = favorite.status === "resolved" ? { favoriteGroup: favorite.favoriteGroup, favoriteMember: favorite.favoriteMember } : {};
  if (!Object.keys(changes).length && !favoriteChange.favoriteGroup && !favoriteChange.favoriteMember) {
    return { status: "ignored", reason: "확인된 변경 사항 없음" };
  }
  const preferences = await updateState(context.user ?? "demo-user", state => {
    state.preferences = mergeFavorite({ ...state.preferences, ...changes }, favoriteChange, catalog);
    return state.preferences;
  });
  const result: Record<string, unknown> = { status: "saved", preferences };
  if (favorite.status === "ambiguous") {
    Object.assign(result, { favoriteNotSaved: { member: favorite.member, candidateGroups: favorite.candidateGroups,
      reason: "같은 이름의 멤버가 여러 그룹에 있어 최애는 저장하지 않았다. 어느 그룹인지 물어본다." } });
  }
  return result as unknown as JsonValue;
};
