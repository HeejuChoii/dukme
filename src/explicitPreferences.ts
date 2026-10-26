// Deterministic fallback for *explicitly stated* Korean favourite and budget facts.
// Croche still performs its normal Memory and savePreferences Tool actions, but the
// demo must not lose clear declarations if a model turn omits the tool call.
import type { FanPreferences } from './state.js';
import type { Aliases, Item } from './data.js';
import { buildFavoriteCatalog, detectFavoriteInText, type FavoriteCatalog } from './favorite.js';

// 최애 판별은 savePreferences Tool과 같은 규칙(src/favorite.ts)을 쓴다. 멤버만 말해도 데이터에서
// 그룹을 찾고, 같은 이름이 여러 그룹에 있으면 저장하지 않는다(덕메가 되묻는다).
export function extractExplicitPreferences(
  text: string,
  items: Item[],
  aliases: Aliases = { members: {}, groups: {} },
  catalog: FavoriteCatalog = buildFavoriteCatalog(items, aliases),
): FanPreferences {
  const changes: FanPreferences = {};
  if (/최애/.test(text) && !/최애(?:가|는)?\s*누구/.test(text)) {
    const favorite = detectFavoriteInText(text, catalog);
    if (favorite.status === 'resolved') {
      if (favorite.favoriteGroup) changes.favoriteGroup = favorite.favoriteGroup;
      if (favorite.favoriteMember) changes.favoriteMember = favorite.favoriteMember;
    }
  }
  const match = text.match(/(?:손민수\s*)?예산(?:은|이|으로|을|은\s*)?[^.!?\n]{0,25}?(\d[\d,]*(?:\.\d+)?)\s*(만|천)?\s*원/);
  if (match) {
    const base = Number(match[1]!.replace(/,/g, ''));
    const multiplier = match[2] === '만' ? 10000 : match[2] === '천' ? 1000 : 1;
    const amount = base * multiplier;
    if (Number.isSafeInteger(amount) && amount >= 0 && amount <= 100000000) changes.budget = amount;
  }
  return changes;
}
