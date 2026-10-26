import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { updateState, type FanPreferences } from "../state.js";

export const savePreferencesDeclaration: ToolDeclaration = {
  name: "savePreferences",
  summary: "대화에서 사용자가 직접 밝힌 최애·예산·색·사이즈·쇼핑/성지 모드를 구조화해 저장한다. 재방문 후 추천 Tool이 실제로 이 값을 적용할 수 있게 한다.",
  commands: [{
    key: "save_preferences", name: "save", reads: false,
    summary: "사용자가 명시적으로 이야기하거나 변경한 항목만 전송한다. 모르는 값은 추측하지 않는다.",
    flags: [
      { name: "favoriteGroup", type: "string", description: "최애 그룹의 정식 이름" },
      { name: "favoriteMember", type: "string", description: "최애 멤버" },
      { name: "budget", type: "integer", minimum: 0, description: "현재 쇼핑 예산(원)" },
      { name: "colors", type: "string", description: "좋아하는 색상 목록, 쉼표 구분" },
      { name: "sizeTop", type: "string", description: "상의 사이즈" },
      { name: "sizeBottom", type: "string", description: "하의 사이즈" },
      { name: "sizeShoes", type: "string", description: "신발 사이즈" },
      { name: "shoppingMode", type: "string", description: "shopping(쇼핑), travel(성지), both(둘 다) 중 하나" },
      { name: "language", type: "string", description: "사용자가 명시한 선호 응답 언어: ko, en, ja, zh-TW" },
    ],
  }],
};

export const savePreferencesHandler: ToolHandler = async (invocation, context) => {
  if (invocation.key !== "save_preferences") return { status: "rejected", reason: "지원하지 않는 동작" };
  const a = invocation.args as Record<string, unknown>;
  const changes: FanPreferences = {};
  for (const key of ["favoriteGroup", "favoriteMember", "sizeTop", "sizeBottom", "sizeShoes"] as const) {
    if (typeof a[key] === "string" && a[key].trim()) changes[key] = a[key].trim().slice(0,80);
  }
  if (typeof a.budget === "number" && Number.isSafeInteger(a.budget) && a.budget >= 0 && a.budget <= 100000000) changes.budget = a.budget;
  if (typeof a.colors === "string" && a.colors.trim()) {
    changes.colors = a.colors.split(/[,，/]/).map(v => v.trim()).filter(Boolean).slice(0,8);
  }
  if (a.shoppingMode === "shopping" || a.shoppingMode === "travel" || a.shoppingMode === "both") changes.shoppingMode = a.shoppingMode;
  if (["ko", "en", "ja", "zh-TW"].includes(String(a.language))) changes.language = a.language as "ko" | "en" | "ja" | "zh-TW";
  if (!Object.keys(changes).length) return { status: "ignored", reason: "확인된 변경 사항 없음" };
  const preferences = await updateState(context.user ?? "demo-user", state => {
    state.preferences = { ...state.preferences, ...changes };
    return state.preferences;
  });
  return { status: "saved", preferences } as unknown as JsonValue;
};
