// PayPal 결제 (Orders API v2, 샌드박스 기본).
// 원칙: 에이전트는 주문을 "만들기"만 한다. 결제 확정(capture)은 팬이 PayPal 창에서 승인한 뒤
// 화면이 서버에 요청할 때만 일어난다. 에이전트가 혼자 돈을 쓰는 경로는 없다.
const env = process.env;

export const PAYPAL_CLIENT_ID = env.PAYPAL_CLIENT_ID?.trim() || "";
const PAYPAL_SECRET = env.PAYPAL_SECRET?.trim() || "";
const PAYPAL_BASE = env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
/** 원화 → 달러 환산(데모용 고정 환율). 해외 팬은 USD로 결제한다. */
export const KRW_PER_USD = Number(env.KRW_PER_USD) > 0 ? Number(env.KRW_PER_USD) : 1400;
export const CURRENCY = "USD";

export const paypalEnabled = (): boolean => Boolean(PAYPAL_CLIENT_ID && PAYPAL_SECRET);

export function krwToUsd(krw: number): string {
  return Math.max(0.01, krw / KRW_PER_USD).toFixed(2);
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal_token_${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function call(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`paypal_${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

export interface PreparedOrder {
  orderId: string;
  user: string;
  itemId: string;
  amount: string;
  createdAt: number;
}

/** 이 서버가 만든 주문만 capture한다(다른 사용자의 주문 id로 결제 확정하는 걸 막는다). */
const prepared = new Map<string, PreparedOrder>();

export async function createOrder(input: { user: string; itemId: string; name: string; brand: string; amount: string }): Promise<PreparedOrder> {
  const data = await call("/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.itemId,
        description: `${input.brand} ${input.name}`.trim().slice(0, 127),
        amount: { currency_code: CURRENCY, value: input.amount },
      },
    ],
    application_context: { brand_name: "Dukme", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
  });
  const order: PreparedOrder = { orderId: data.id, user: input.user, itemId: input.itemId, amount: input.amount, createdAt: Date.now() };
  prepared.set(order.orderId, order);
  return order;
}

export function preparedOrder(orderId: string): PreparedOrder | undefined {
  return prepared.get(orderId);
}

export async function captureOrder(orderId: string): Promise<{ status: string; captureId: string | null }> {
  const data = await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
  prepared.delete(orderId);
  const captureId = data?.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;
  return { status: String(data.status ?? "UNKNOWN"), captureId };
}
