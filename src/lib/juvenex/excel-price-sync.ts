/**
 * Plans a price update from an uploaded spreadsheet.
 * The first row must name a SKU column and a price column.
 * An optional product id column wins when that id is on the dashboard.
 */

const PRICE_RE = /^\d+(\.\d{1,2})?$/

export type ExcelCatalogRow = {
  productId: string
  sku: string
  name: string
  currentPrice: string
}

export type ExcelPriceChange = {
  productId: string
  sku: string
  name: string
  oldPrice: string
  newPrice: string
}

export type ExcelSyncPlan = {
  changes: ExcelPriceChange[]
  unchanged: number
  skipped: { row: number; reason: string }[]
}

function cell(value: unknown): string {
  return String(value ?? '').trim()
}

function headerName(value: unknown): string {
  return cell(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function money(value: unknown): string | null {
  const raw = cell(value).replace(/[$,]/g, '')
  if (!raw || !PRICE_RE.test(raw) || Number(raw) <= 0) return null
  return (Math.round(Number(raw) * 100) / 100).toFixed(2)
}

function cents(value: string): number {
  return Math.round(Number(value) * 100)
}

export function planExcelSync(table: unknown[][], products: ExcelCatalogRow[]): ExcelSyncPlan {
  if (!table.length) throw new Error('The spreadsheet is empty.')
  const header = table[0].map(headerName)
  const skuCol = header.findIndex((name) => name === 'sku' || name === 'product sku')
  const priceCol = header.findIndex(
    (name) => name === 'price' || name === 'product price' || name === 'retail price'
  )
  const idCol = header.findIndex((name) => name === 'product id' || name === 'id')
  if (skuCol < 0 || priceCol < 0) {
    throw new Error('The file needs column headers for SKU and price.')
  }

  const byId = new Map(products.map((product) => [product.productId, product]))
  const bySku = new Map<string, ExcelCatalogRow[]>()
  for (const product of products) {
    const sku = product.sku.trim().toLowerCase()
    if (!sku) continue
    const list = bySku.get(sku) ?? []
    list.push(product)
    bySku.set(sku, list)
  }

  const plan: ExcelSyncPlan = { changes: [], unchanged: 0, skipped: [] }
  const seen = new Set<string>()

  table.slice(1).forEach((row, index) => {
    const rowNumber = index + 2
    const sku = cell(row[skuCol])
    const id = idCol >= 0 ? cell(row[idCol]) : ''
    if (!sku && !id) return
    const price = money(row[priceCol])
    if (!price) {
      plan.skipped.push({ row: rowNumber, reason: 'Blank or invalid price' })
      return
    }

    let match: ExcelCatalogRow | undefined
    if (id && byId.has(id)) {
      match = byId.get(id)
    } else {
      const hits = sku ? bySku.get(sku.toLowerCase()) ?? [] : []
      if (hits.length > 1) {
        plan.skipped.push({ row: rowNumber, reason: `More than one product uses SKU ${sku}` })
        return
      }
      match = hits[0]
    }
    if (!match) {
      plan.skipped.push({ row: rowNumber, reason: 'No matching product on this site' })
      return
    }
    if (seen.has(match.productId)) {
      plan.skipped.push({ row: rowNumber, reason: `Duplicate row for product ${match.productId}` })
      return
    }
    seen.add(match.productId)
    if (match.currentPrice && cents(match.currentPrice) === cents(price)) {
      plan.unchanged += 1
      return
    }
    plan.changes.push({
      productId: match.productId,
      sku: match.sku || sku,
      name: match.name,
      oldPrice: match.currentPrice,
      newPrice: price,
    })
  })

  return plan
}
