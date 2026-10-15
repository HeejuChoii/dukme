// Read-only mock data access. Only data/items.json and data/places.json are the source of
// truth — tools must not invent facts that are not in these files (PRD §8).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "data");

export interface Item {
  id: string;
  group: string;
  member: string;
  situation: string;
  date: string;
  category: string;
  brand: string;
  name: string;
  price: number;
  url: string;
  features: string;
  isOriginal: boolean;
  alternativeOf: string | null;
}

export interface PlaceVisit {
  group: string;
  member: string;
  date: string;
  context: string;
}

export interface Place {
  id: string;
  name: string;
  area: string;
  address: string;
  type: string;
  visits: PlaceVisit[];
  openHours: string;
  note: string;
}

export interface Aliases {
  members: Record<string, string[]>;
  groups: Record<string, string[]>;
}

let itemsCache: Item[] | null = null;
let placesCache: Place[] | null = null;
let aliasesCache: Aliases | null = null;

export async function loadItems(): Promise<Item[]> {
  if (!itemsCache) {
    const raw = await readFile(path.join(dataDir, "items.json"), "utf-8");
    itemsCache = JSON.parse(raw) as Item[];
  }
  return itemsCache;
}

export async function loadPlaces(): Promise<Place[]> {
  if (!placesCache) {
    const raw = await readFile(path.join(dataDir, "places.json"), "utf-8");
    placesCache = JSON.parse(raw) as Place[];
  }
  return placesCache;
}

export async function loadAliases(): Promise<Aliases> {
  if (!aliasesCache) {
    const raw = await readFile(path.join(dataDir, "aliases.json"), "utf-8");
    aliasesCache = JSON.parse(raw) as Aliases;
  }
  return aliasesCache;
}

export async function findItemById(id: string): Promise<Item | undefined> {
  const items = await loadItems();
  return items.find((i) => i.id === id);
}

export async function findPlaceById(id: string): Promise<Place | undefined> {
  const places = await loadPlaces();
  return places.find((p) => p.id === id);
}
