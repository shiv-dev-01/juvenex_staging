import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  categoryKey,
  mapPanelCatalog,
  omitHiddenPlans,
  parseCategoryNames,
  parseProductPayload,
  withPanelPrices,
} from './panel-storefront'

describe('panel storefront mapping', () => {
  test('slugs category names the shop can put in the URL', () => {
    assert.equal(categoryKey('Weight Loss'), 'weight-loss')
    assert.equal(categoryKey('TRT'), 'trt')
    assert.equal(categoryKey('Erectile Dysfunction'), 'erectile-dysfunction')
  })

  test('reads the category list payload', () => {
    assert.deepEqual(
      parseCategoryNames({
        status: 1,
        category_data: ['TRT', 'Weight Loss', 'TRT', '  '],
      }),
      ['TRT', 'Weight Loss']
    )
  })

  test('reads a product list and ignores the missing controller method', () => {
    assert.equal(
      parseProductPayload(200, '', { status: 1, product: [{ product_id: '1' }] }).kind,
      'products'
    )
    assert.equal(
      parseProductPayload(200, '', { status: 1, product_data: [] }).kind,
      'products'
    )
    assert.equal(
      parseProductPayload(500, '', {
        message: 'Method App\\Http\\Controllers\\ApiController::GetProductByCategory does not exist.',
      }).kind,
      'missing-method'
    )
  })

  test('maps a category row into one checkout plan', () => {
    const mapped = mapPanelCatalog({
      categoryNames: ['TRT', 'Weight Loss'],
      productsByCategory: {
        TRT: [
          {
            product_id: '123',
            product_name: 'TESTOSTERONE CYPIONATE 200MG/ML',
            product_price: '129.00',
            product_sku: 'TEST-CYP-200MG',
            product_description: 'TESTOSTERONE CYPIONATE 200MG/ML BM:3',
            product_category_name: 'TRT',
          },
        ],
        'Weight Loss': [
          {
            product_id: '115',
            product_name: 'Semaglutide  - 1 months supply',
            product_price: '190.00',
            product_sku: 'Semaginj-CR1-1M',
          },
          {
            product_id: '999',
            product_name: 'duplicate',
            product_price: '1',
            product_sku: 'DUP',
          },
        ],
      },
    })

    assert.deepEqual(
      mapped.categories.map((category) => category.key),
      ['trt', 'weight-loss']
    )
    assert.equal(mapped.products.length, 3)
    const trt = mapped.products.find((product) => product.category === 'trt')
    assert.ok(trt)
    assert.equal(trt.slug, 'testosterone-cypionate-200mg-ml-123')
    assert.equal(trt.startingPrice, 129)
    assert.equal(trt.plans?.[0]?.productId, '123')
    assert.equal(trt.plans?.[0]?.sku, 'TEST-CYP-200MG')
    assert.equal(trt.plans?.[0]?.checkoutUrl, 'https://checkout.juvenex.app/?id=123')

    const sema = mapped.products.find((product) => product.plans?.[0]?.productId === '115')
    assert.equal(sema?.plans?.[0]?.label, '1 month')
    assert.equal(sema?.plans?.[0]?.months, 1)
    assert.equal(sema?.plans?.[0]?.price, 190)
  })

  test('replaces a plan price from the site 614 index and keeps the rest', () => {
    const priced = withPanelPrices(
      {
        startingPrice: 190,
        plans: [
          { productId: '46', sku: 'SEMA-1M', price: 190 },
          { productId: '47', sku: 'SEMA-3M', price: 399 },
        ],
      },
      { byId: { '46': { price: 191, sku: 'sema-1m' } } }
    )
    assert.equal(priced.plans?.[0]?.price, 191)
    assert.equal(priced.plans?.[1]?.price, 399)
    assert.equal(priced.startingPrice, 191)
  })

  test('does not apply a panel price when the SKU belongs to a different product', () => {
    const priced = withPanelPrices(
      {
        startingPrice: 720,
        plans: [{ productId: '256', sku: 'TADA-20MG-120-10-12B', price: 720 }],
      },
      { byId: { '256': { price: 30, sku: 'omeprazole40mg' } } }
    )
    assert.equal(priced.plans?.[0]?.price, 720)
    assert.equal(priced.startingPrice, 720)
  })

  test('hides a plan an admin turned off', () => {
    const shown = omitHiddenPlans(
      {
        startingPrice: 190,
        plans: [
          { productId: '46', sku: 'SEMA-1M', price: 191 },
          { productId: '47', sku: 'SEMA-3M', price: 399 },
        ],
      },
      new Set(['46'])
    )
    assert.equal(shown?.plans?.length, 1)
    assert.equal(shown?.plans?.[0]?.productId, '47')
    assert.equal(shown?.startingPrice, 399)
    assert.equal(
      omitHiddenPlans(
        { startingPrice: 191, plans: [{ productId: '46', sku: 'SEMA-1M', price: 191 }] },
        new Set(['46'])
      ),
      null
    )
  })
})
