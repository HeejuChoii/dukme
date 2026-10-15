// A tool handler runs inside the same server process as the web page's SSE connections.
// Rather than guess at the shape of tool-result events on the Croche agent stream, handlers
// publish their own structured result here, and the server forwards it to the page verbatim.
// This keeps card rendering tied to the actual data the tool returned, not a re-parse of text.
export interface CardEvent {
  tool: "searchItem" | "findAlternative" | "addWishlist" | "planRoute" | "updateOwned" | "markVisited";
  data: unknown;
}

type Listener = (event: CardEvent) => void;

const listeners = new Set<Listener>();

export function onCard(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitCard(event: CardEvent): void {
  for (const listener of listeners) listener(event);
}
