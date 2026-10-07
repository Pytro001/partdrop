import { describe, expect, it } from 'vitest'
import { toleranceCheck } from '../server/src/inspect.ts'

const rows = [
  { id: 'OD', name: 'OD', nominal: 120, tol: 0.1, measured: 120.03 },
  { id: 'B', name: 'Bore', nominal: 50, tol: 0.025, measured: 49.995 },
]
describe('tolerance check', () => {
  it('passes when every feature is inside its band', () => expect(toleranceCheck(rows).verdict).toBe('PASS'))
  it('fails on one feature out of band', () => {
    const r = toleranceCheck([...rows, { id: 'T', name: 'T', nominal: 12, tol: 0.05, measured: 12.08 }])
    expect(r.verdict).toBe('FAIL')
    expect(r.rows.find(x => x.id === 'T')!.pass).toBe(false)
  })
  it('fails when a measurement is missing', () => expect(toleranceCheck([{ ...rows[0], measured: null }]).verdict).toBe('FAIL'))
  it('treats the tolerance edge as inside', () => expect(toleranceCheck([{ ...rows[0], measured: 120.1 }]).verdict).toBe('PASS'))
})
