// App-authoritative structured state: wishlist / owned items / visited places.
// Croche's own agent memory remembers free-text facts (최애 그룹·멤버, 예산, 사이즈, 취향)
// from the conversation itself; this file is for the deterministic lists the tools mutate,
// per the Croche guidance to "keep authoritative inventory in the app". Plain JSON on disk,
// so it survives a server restart exactly like FileStorage does for the conversation.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(here, "..", "app-state");

export interface FanPreferences {
  favoriteGroup?: string;
  favoriteMember?: string;
  budget?: number;
  colors?: string[];
  sizeTop?: string;
  sizeBottom?: string;
  sizeShoes?: string;
  shoppingMode?: "shopping" | "travel" | "both";
  language?: "ko" | "en" | "ja" | "zh-CN" | "zh-TW"; // 사용자가 선택한 응답 언어
}

export interface AppState {
  wishlist: string[]; // item ids
  owned: string[]; // item ids
  visitedPlaces: string[]; // place ids
  preferences: FanPreferences;
  purchaseClicks: number; // "사러 가기" 클릭 수 (데모용 카운터)
}

function emptyState(): AppState {
  return { wishlist: [], owned: [], visitedPlaces: [], preferences: {}, purchaseClicks: 0 };
}

function stateFile(user: string): string {
  return path.join(stateDir, `${user}.json`);
}

export async function readState(user: string): Promise<AppState> {
  try {
    const raw = await readFile(stateFile(user), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      wishlist: parsed.wishlist ?? [],
      owned: parsed.owned ?? [],
      visitedPlaces: parsed.visitedPlaces ?? [],
      purchaseClicks: parsed.purchaseClicks ?? 0,
      preferences: parsed.preferences ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeStateRaw(user: string, state: AppState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const target = stateFile(user);
  // 임시 파일에 쓰고 rename — 동시 쓰기가 섞여서 JSON이 깨지는 걸 막는다 (rename은 원자적).
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, target);
}

export async function writeState(user: string, state: AppState): Promise<void> {
  await writeStateRaw(user, state);
}

export async function resetState(user: string): Promise<void> {
  await writeStateRaw(user, emptyState());
}

// 같은 유저에 대해 updateOwned/markVisited/addWishlist가 한 턴에 같이 호출되는 경우가 있어서,
// 읽고-고치고-쓰는 전체 과정을 유저별로 한 번에 하나씩만 돌게 직렬화한다 (lost-update 방지).
const locks = new Map<string, Promise<unknown>>();

export async function updateState<T>(user: string, mutate: (state: AppState) => T | Promise<T>): Promise<T> {
  const previous = locks.get(user) ?? Promise.resolve();
  let result!: T;
  const next = previous
    .catch(() => {})
    .then(async () => {
      const state = await readState(user);
      result = await mutate(state);
      await writeStateRaw(user, state);
    });
  locks.set(user, next);
  await next;
  return result;
}
