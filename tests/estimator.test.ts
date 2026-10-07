import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { estimate, priceFromEstimate } from '../server/src/shop.ts'
import type { PartFeatures } from '../shared/types.ts'

const F = JSON.parse(readFileSync(new URL('../samples/features.json', import.meta.url), 'utf8')) as Record<string, PartFeatures>

describe('machine time estimator', () => {
  it('flange is feasible on a 3 axis mill and cheaper than 5 axis', () => {
    const a = estimate(F.flange, 'vmc-1', 'al6061', 10), b = estimate(F.flange, '5ax-1', 'al6061', 10)
    expect(a.feasible).toBe(true)
    expect(b.feasible).toBe(true)
    expect(priceFromEstimate(a).total).toBeLessThan(priceFromEstimate(b).total)
  })
  it('injector cannot be milled (internal channels) but can be printed', () => {
    expect(estimate(F.injector, '5ax-1', 'in718', 2).feasible).toBe(false)
    expect(estimate(F.injector, 'lpbf-1', 'in718', 2).feasible).toBe(true)
  })
  it('cover is a sheet part, bracket is not', () => {
    expect(estimate(F.cover, 'sheet-1', 'al5052', 25).feasible).toBe(true)
    expect(estimate(F.bracket, 'sheet-1', 'al5052', 25).feasible).toBe(false)
  })
  it('a machine refuses a material it does not run', () => {
    const e = estimate(F.flange, 'vmc-1', 'in718', 1)
    expect(e.feasible).toBe(false)
    expect(e.issues[0]).toMatch(/does not run/)
  })
  it('price lines add up to subtotal plus margin', () => {
    const p = priceFromEstimate(estimate(F.bracket, 'vmc-2', 'al6061', 50))
    const sum = p.lines.reduce((a, l) => a + l.amount, 0)
    expect(Math.abs(sum - p.subtotal)).toBeLessThan(0.02)
    expect(Math.abs(p.subtotal + p.margin - p.total)).toBeLessThan(0.02)
  })
  it('more parts cost more in total and less per part', () => {
    const one = priceFromEstimate(estimate(F.bracket, 'vmc-1', 'al6061', 1)), many = priceFromEstimate(estimate(F.bracket, 'vmc-1', 'al6061', 50))
    expect(many.total).toBeGreaterThan(one.total)
    expect(many.unit_price).toBeLessThan(one.unit_price)
  })
})

describe('measured geometry of the samples', () => {
  it('finds the holes', () => {
    expect(F.bracket.hole_estimate).toBe(4)
    expect(F.flange.hole_estimate).toBe(7) // 6 bolt holes plus the bore
    expect(F.cover.hole_estimate).toBe(4)
  })
  it('flags internal channels on the injector only', () => {
    expect(F.injector.hidden_area_5axis_pct).toBeGreaterThan(5)
    for (const k of ['bracket', 'flange', 'cover']) expect(F[k].hidden_area_3axis_pct).toBeLessThan(1)
  })
  it('detects the 1.5 mm sheet and its two bends', () => {
    expect(F.cover.constant_thickness_mm).toBe(1.5)
    expect(F.cover.bend_estimate).toBe(2)
  })
})
