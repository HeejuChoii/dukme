// Deterministic fallback for *explicitly stated* Korean favourite and budget facts.
// Croche still performs its normal Memory and savePreferences Tool actions, but the
// demo must not lose clear declarations if a model turn omits the tool call.
import type { FanPreferences } from './state.js';
import type { Item } from './data.js';

export function extractExplicitPreferences(text: string, items: Item[]): FanPreferences {
  const changes: FanPreferences = {};
  if (/최애/.test(text) && !/최애(?:가|는)?\s*누구/.test(text)) {
    const groups = [...new Set(items.map(i => i.group))]
      .filter(g => g.toLowerCase() !== '단체')
      .filter(g => text.toLowerCase().includes(g.toLowerCase()));
    if (groups.length === 1) {
      changes.favoriteGroup = groups[0];
      const members = [...new Set(items.filter(i => i.group === groups[0] && i.member !== '단체').map(i => i.member))]
        .filter(member => text.includes(member));
      if (members.length === 1) changes.favoriteMember = members[0];
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
