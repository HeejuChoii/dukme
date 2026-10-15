import type { ToolDeclaration, ToolHandler } from "@h1r-ai/croche";
import { searchItemDeclaration, searchItemHandler } from "./searchItem.js";
import { findAlternativeDeclaration, findAlternativeHandler } from "./findAlternative.js";
import { addWishlistDeclaration, addWishlistHandler } from "./addWishlist.js";
import { planRouteDeclaration, planRouteHandler } from "./planRoute.js";
import { updateOwnedDeclaration, updateOwnedHandler } from "./updateOwned.js";
import { markVisitedDeclaration, markVisitedHandler } from "./markVisited.js";

export const toolDeclarations: ToolDeclaration[] = [
  searchItemDeclaration,
  findAlternativeDeclaration,
  addWishlistDeclaration,
  planRouteDeclaration,
  updateOwnedDeclaration,
  markVisitedDeclaration,
];

export const toolHandlers: Record<string, ToolHandler> = {
  searchItem: searchItemHandler,
  findAlternative: findAlternativeHandler,
  addWishlist: addWishlistHandler,
  planRoute: planRouteHandler,
  updateOwned: updateOwnedHandler,
  markVisited: markVisitedHandler,
};
