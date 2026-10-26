import assert from 'node:assert/strict';
import { extractExplicitPreferences } from '../src/explicitPreferences.js';
import { buildFavoriteCatalog, canonicalGroup, mergeFavorite } from '../src/favorite.js';
import { savePreferencesHandler } from '../src/tools/savePreferences.js';
import { readState, resetState, updateState } from '../src/state.js';
import { loadAliases, loadItems, type Item } from '../src/data.js';

const items = await loadItems();
const aliases = await loadAliases();
const catalog = buildFavoriteCatalog(items, aliases);
const user = 'test-favorite';
const ctx = { user, causedBy: [] } as unknown as Parameters<typeof savePreferencesHandler>[1];
const inv = (args: Record<string, unknown>) => ({ key: 'save_preferences', args }) as Parameters<typeof savePreferencesHandler>[0];

try {
  // 1) 기존 IVE 상태에서 "내 최애는 사쿠야야" → NCT WISH / 사쿠야 (server.ts 직접 추출 경로)
  const sakuya = extractExplicitPreferences('내 최애는 사쿠야야', items, aliases);
  assert.deepEqual(sakuya, { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' });
  const merged = mergeFavorite({ favoriteGroup: 'IVE', budget: 50000 }, sakuya, catalog);
  assert.deepEqual(merged, { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야', budget: 50000 });

  // 같은 상황, savePreferences Tool 경로 — 모델이 멤버만 보내도, 예전 그룹을 붙여 보내도 NCT WISH
  await resetState(user);
  await updateState(user, (s) => { s.preferences = { favoriteGroup: 'IVE', favoriteMember: '장원영' }; });
  let saved = await savePreferencesHandler(inv({ favoriteMember: '사쿠야' }), ctx) as any;
  assert.equal(saved.status, 'saved');
  assert.deepEqual((await readState(user)).preferences, { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' });
  await updateState(user, (s) => { s.preferences = { favoriteGroup: 'IVE' }; });
  await savePreferencesHandler(inv({ favoriteGroup: '아이브', favoriteMember: '사쿠야' }), ctx);
  assert.deepEqual((await readState(user)).preferences, { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' });

  // 2) "나 원영이 최애야" → IVE / 장원영 (데이터의 정식 멤버명)
  assert.deepEqual(extractExplicitPreferences('나 원영이 최애야', items, aliases), { favoriteGroup: 'IVE', favoriteMember: '장원영' });
  await savePreferencesHandler(inv({ favoriteMember: '원영' }), ctx);
  assert.deepEqual((await readState(user)).preferences, { favoriteGroup: 'IVE', favoriteMember: '장원영' });

  // 3) 그룹 별명·한글 표기 → 정식 그룹명
  assert.equal(canonicalGroup('아이브', catalog), 'IVE');
  assert.equal(canonicalGroup('엔시티 위시', catalog), 'NCT WISH');
  assert.equal(canonicalGroup('위시', catalog), 'NCT WISH');
  assert.deepEqual(extractExplicitPreferences('내 최애 그룹은 엔시티 위시야', items, aliases), { favoriteGroup: 'NCT WISH' });
  assert.deepEqual(extractExplicitPreferences('최애는 위시 리쿠!', items, aliases), { favoriteGroup: 'NCT WISH', favoriteMember: '리쿠' });
  // "위시리스트"는 그룹명이 아니다
  assert.deepEqual(extractExplicitPreferences('최애템 위시리스트에 넣어줘', items, aliases), {});

  // 4) 그룹만 바꾸면: 새 그룹에 없는 예전 멤버는 지우고, 있으면 유지
  assert.deepEqual(mergeFavorite({ favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' }, { favoriteGroup: 'IVE' }, catalog), { favoriteGroup: 'IVE' });
  assert.deepEqual(mergeFavorite({ favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' }, { favoriteGroup: 'NCT WISH' }, catalog), { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' });
  await updateState(user, (s) => { s.preferences = { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' }; });
  await savePreferencesHandler(inv({ favoriteGroup: '아이브' }), ctx);
  assert.deepEqual((await readState(user)).preferences, { favoriteGroup: 'IVE' });

  // 5) 두 그룹에 같은 멤버명이 있으면 저장하지 않는다
  const twoGroups = [
    { group: 'NCT WISH', member: '사쿠야' },
    { group: 'TEST GROUP', member: '사쿠야' },
    { group: 'IVE', member: '장원영' },
  ] as Item[];
  assert.deepEqual(extractExplicitPreferences('내 최애는 사쿠야야', twoGroups), {});
  // 그룹을 같이 말하면 그 그룹으로 정해진다
  assert.deepEqual(extractExplicitPreferences('내 최애는 nct wish 사쿠야야', twoGroups, aliases), { favoriteGroup: 'NCT WISH', favoriteMember: '사쿠야' });
  // Tool 경로: 실제 데이터에 같은 이름이 두 그룹에 있는 경우를 흉내 내려고 items에 한 줄 끼워 넣는다
  const sakuyaItem = items.find((i) => i.member === '사쿠야')!;
  items.push({ ...sakuyaItem, id: 'test_dup_sakuya', group: 'TEST GROUP' });
  try {
    await updateState(user, (s) => { s.preferences = { favoriteGroup: 'IVE' }; });
    const ambiguous = await savePreferencesHandler(inv({ favoriteMember: '사쿠야' }), ctx) as any;
    assert.equal(ambiguous.status, 'needs_group');
    assert.deepEqual([...ambiguous.candidateGroups].sort(), ['NCT WISH', 'TEST GROUP']);
    assert.deepEqual((await readState(user)).preferences, { favoriteGroup: 'IVE' });
  } finally {
    items.pop();
  }

  // 6) 일반 단어를 멤버로 오인하지 않는다 ("한 번" ≠ Stray Kids 한)
  assert.deepEqual(extractExplicitPreferences('최애 한 번 맞혀 봐', items, aliases), {});

  // 7) 기억 초기화(scope=all)의 app-state 쪽: 최애·예산 선호까지 전부 비워진다
  await updateState(user, (s) => { s.preferences = { favoriteGroup: 'IVE', favoriteMember: '장원영', budget: 50000 }; });
  await resetState(user);
  assert.deepEqual((await readState(user)).preferences, {});

  console.log('PASS: 멤버만 말해도 데이터로 그룹 추론, 그룹 별명 정규화, 동명이인 그룹은 저장 안 함, 초기화 시 선호 비움');
} finally {
  await resetState(user);
}
