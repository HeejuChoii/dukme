import assert from 'node:assert/strict';
import { orderByProximity, pathLengthKm, type LatLng } from '../src/routeOrder.js';
import { planRouteHandler } from '../src/tools/planRoute.js';
import { addWishlistHandler } from '../src/tools/addWishlist.js';
import { updateOwnedHandler } from '../src/tools/updateOwned.js';
import { readState, resetState } from '../src/state.js';

// 두 선분이 서로 교차하는지 (끝점 공유는 교차로 보지 않음). 좁은 지역이라 위경도를 평면으로 본다.
function segmentsCross(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const cross = (p: LatLng, q: LatLng, r: LatLng) => (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function hasCrossing(path: LatLng[]): boolean {
  for (let i = 0; i + 1 < path.length; i++)
    for (let j = i + 2; j + 1 < path.length; j++) if (segmentsCross(path[i]!, path[i + 1]!, path[j]!, path[j + 1]!)) return true;
  return false;
}

// 1) 지그재그 입력 → 첫 장소 유지, 교차 없음, 더 짧음
const zigzag = [
  { id: 'A', lat: 37.50, lng: 127.00 },
  { id: 'B', lat: 37.50, lng: 127.03 },
  { id: 'C', lat: 37.52, lng: 127.00 },
  { id: 'D', lat: 37.52, lng: 127.03 },
  { id: 'E', lat: 37.51, lng: 127.015 },
];
assert.ok(hasCrossing(zigzag), '테스트 입력은 교차가 있어야 함');
const ordered = orderByProximity(zigzag);
assert.equal(ordered[0]!.id, 'A', '가장 우선인 첫 장소는 그대로 첫 번째');
assert.equal(ordered.length, zigzag.length);
assert.ok(!hasCrossing(ordered), '정리된 경로는 교차가 없어야 함');
assert.ok(pathLengthKm(ordered) < pathLengthKm(zigzag));
// 좌표 없는 장소는 빠지지 않고 뒤로
const withMissing = orderByProximity([...zigzag, { id: 'X', lat: Number.NaN, lng: Number.NaN }]);
assert.equal(withMissing.at(-1)!.id, 'X');

// 2) 실제 planRoute: 최애가 다녀간 곳이 첫 번째, 하루 코스 선이 교차하지 않음
const user = 'test-route-wishlist';
const ctx = { user, causedBy: [] } as unknown as Parameters<typeof planRouteHandler>[1];
const inv = (key: string, args: Record<string, unknown>) => ({ key, args }) as Parameters<typeof planRouteHandler>[0];
try {
  await resetState(user);
  for (const area of ['용산구', '종로구', '강남구', '강릉시']) {
    const route = await planRouteHandler(inv('plan_route', { area, maxStops: 6, member: '사쿠야', group: 'NCT WISH' }), ctx) as any;
    const course = route.course as Array<LatLng & { isFavoriteMemberVisit: boolean; day: number }>;
    if (course.length < 3) continue;
    if (course.some((s) => s.isFavoriteMemberVisit)) assert.ok(course[0]!.isFavoriteMemberVisit, `${area}: 최애가 다녀간 곳이 첫 번째`);
    assert.ok(!hasCrossing(course), `${area}: 코스 선이 교차하지 않아야 함`);
  }

  // 3) 찜 → 산다고 하면 보유로 옮겨지고 찜에서는 빠진다
  await addWishlistHandler(inv('add_wishlist', { itemId: 'item_096' }), ctx);
  await addWishlistHandler(inv('add_wishlist', { itemId: 'item_353' }), ctx);
  assert.deepEqual((await readState(user)).wishlist, ['item_096', 'item_353']);
  await updateOwnedHandler(inv('update_owned', { itemId: 'item_353' }), ctx);
  const after = await readState(user);
  assert.deepEqual(after.wishlist, ['item_096']);
  assert.deepEqual(after.owned, ['item_353']);
  console.log('PASS: 코스 순서(첫 장소 유지·교차 없음), 찜 → 보유 이동');
} finally {
  await resetState(user);
}
