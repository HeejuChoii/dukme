import type { ToolDeclaration, ToolHandler, JsonValue } from "@h1r-ai/croche";
import { findItemById } from "../data.js";
import { emitCard, dedupeKeyFor } from "../bus.js";
import { CURRENCY, KRW_PER_USD, createOrder, krwToUsd, paypalEnabled } from "../paypal.js";

export const buyWithPayPalDeclaration: ToolDeclaration = {
  name: "buyWithPayPal",
  summary:
    "사용자가 특정 아이템을 '사줘', '결제할게', 'buy it' 처럼 명확히 사겠다고 할 때 PayPal 주문을 준비한다. 결제를 확정하지는 않는다: 화면에 PayPal 승인 버튼이 뜨고, 사용자가 직접 승인해야 결제가 끝난다.",
  commands: [
    {
      key: "prepare_checkout",
      name: "prepare",
      reads: false,
      summary: "itemId의 원화 가격을 USD로 바꿔 PayPal 주문을 만들고, 화면에 승인 버튼을 띄운다. 가격 미확인 아이템이나 팬 계정 미검증 아이템은 거절된다.",
      flags: [{ name: "itemId", type: "string", required: true, description: "살 아이템의 id (searchItem/findAlternative 결과)" }],
    },
  ],
};

export const buyWithPayPalHandler: ToolHandler = async (invocation, context) => {
  if (invocation.key !== "prepare_checkout") return { status: "rejected", reason: "알 수 없는 동작이에요." };
  const args = invocation.args as Record<string, unknown>;
  const itemId = String(args.itemId ?? "").trim();
  const item = await findItemById(itemId);
  if (!item) return { status: "rejected", reason: `itemId '${itemId}'를 찾을 수 없어요.` };
  if (!paypalEnabled()) return { status: "rejected", reason: "PayPal 결제가 아직 설정되지 않았어요(서버 환경변수)." };
  if (item.matchType === "source_only") {
    return { status: "rejected", reason: "팬 계정 출처(미검증) 아이템이라 결제를 준비하지 않아요. 검수된 제품이나 대체템을 골라 주세요." };
  }
  if (typeof item.price !== "number" || item.price <= 0) {
    return { status: "rejected", reason: "가격이 확인되지 않은 아이템이라 결제를 준비할 수 없어요." };
  }

  const amount = krwToUsd(item.price);
  const user = context.user ?? "demo-user";
  try {
    const order = await createOrder({ user, itemId: item.id, name: item.name, brand: item.brand, amount });
    const result = {
      status: "awaiting_user_approval",
      note: "주문만 준비됐다. 사용자가 화면의 PayPal 버튼으로 직접 승인해야 결제가 완료된다. 결제됐다고 말하지 않는다.",
      orderId: order.orderId,
      item,
      priceKrw: item.price,
      amount,
      currency: CURRENCY,
      rate: KRW_PER_USD,
      sandbox: process.env.PAYPAL_ENV !== "live",
    };
    emitCard({ tool: "buyWithPayPal", data: result, user: context.user }, dedupeKeyFor("buyWithPayPal", invocation.key, args, context.causedBy));
    return result as unknown as JsonValue;
  } catch (error) {
    console.error("paypal create order failed:", error);
    return { status: "rejected", reason: "PayPal 주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
};
