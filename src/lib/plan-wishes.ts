/** Permission / objection for a plan: a wish, not a legal order. */
export type WishKind = "permission" | "objection";

export const WISH_LABELS: Record<WishKind, string> = {
  permission: "Permission",
  objection: "Objection",
};

export const WISHES_NOTE =
  "Permission and objection express wishes, not legal orders. If neither an objection nor permission is received, the default is no objection, not that nobody has provided permission.";
