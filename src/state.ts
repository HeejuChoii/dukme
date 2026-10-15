// App-authoritative structured state: wishlist / owned items / visited places.
// Croche's own agent memory remembers free-text facts (최애 그룹·멤버, 예산, 사이즈, 취향)
// from the conversation itself; this file is for the deterministic lists the tools mutate,
// per the Croche guidance to "keep authoritative inventory in the app". Plain JSON on disk,
// so it survives a server restart exactly like FileStorage does for the conversation.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(here, "..", "app-state");

export interface AppState {
  wishlist: string[]; // item ids
  owned: string[]; // item ids
  visitedPlaces: string[]; // place ids
}

function emptyState(): AppState {
  return { wishlist: [], owned: [], visitedPlaces: [] };
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
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function writeState(user: string, state: AppState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile(user), JSON.stringify(state, null, 2), "utf-8");
}

export async function resetState(user: string): Promise<void> {
  await writeState(user, emptyState());
}
