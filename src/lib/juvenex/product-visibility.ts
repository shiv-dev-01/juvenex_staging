import 'server-only'

/**
 * The panel stores status. POST /juvenex/api/product-status-update toggles it
 * and returns product_status. Get_Products does not include that field, so the
 * latest status from that API is remembered here and the shop hides those ids.
 * No database.
 */
const activeById = new Map<string, boolean>()

export function rememberProductActive(productId: string, active: boolean) {
  activeById.set(productId, active)
}

export function hiddenProductIds(): Set<string> {
  const hidden = new Set<string>()
  for (const [id, active] of activeById) {
    if (!active) hidden.add(id)
  }
  return hidden
}
