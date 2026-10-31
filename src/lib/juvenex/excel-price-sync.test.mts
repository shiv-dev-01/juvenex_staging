import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { planExcelSync } from './excel-price-sync'

const catalog = [
  { productId: '46', sku: 'SEMA-1M', name: 'Semaglutide 1 month', currentPrice: '190.00' },
  { productId: '1', sku: 'SEMA-1M', name: 'Semaglutide other', currentPrice: '190.00' },
  { productId: '47', sku: 'SEMA-3M', name: 'Semaglutide 3 months', currentPrice: '399.00' },
]

describe('excel price sync', () => {
  test('updates a unique SKU and leaves an unchanged price alone', () => {
    const plan = planExcelSync(
      [
        ['Product', 'SKU', 'Price'],
        ['Semaglutide', 'SEMA-3M', '$410.00'],
        ['Semaglutide', 'SEMA-1M', '190'],
      ],
      catalog
    )
    assert.equal(plan.changes.length, 1)
    assert.equal(plan.changes[0]?.productId, '47')
    assert.equal(plan.changes[0]?.newPrice, '410.00')
    assert.ok(plan.skipped.some((row) => row.reason.includes('More than one product')))
  })

  test('uses the product id when the SKU is shared', () => {
    const plan = planExcelSync(
      [
        ['product id', 'sku', 'price'],
        ['46', 'SEMA-1M', '191.00'],
        ['47', 'SEMA-3M', '399'],
      ],
      catalog
    )
    assert.deepEqual(plan.changes, [
      {
        productId: '46',
        sku: 'SEMA-1M',
        name: 'Semaglutide 1 month',
        oldPrice: '190.00',
        newPrice: '191.00',
      },
    ])
    assert.equal(plan.unchanged, 1)
    assert.equal(plan.skipped.length, 0)
  })
})
