import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPromoMessage } from '../scripts/lib/promo-mail.mjs'
import { dripCampaign, dripTags, dripDedupeDays, screenDrip, breakerHalt } from '../scripts/lib/promo-metrics.mjs'
import { OutreachMetrics, Ledger, ledgerPath } from '../scripts/lib/outreach-metrics.mjs'

const saved = process.env.UNSUB_SECRET
beforeAll(() => { process.env.UNSUB_SECRET = 'test-secret-not-for-production-0123456789' })
afterAll(() => { if (saved === undefined) delete process.env.UNSUB_SECRET; else process.env.UNSUB_SECRET = saved })

const dir = () => mkdtempSync(join(tmpdir(), 'promo-m-'))
const NOW = new Date('2026-12-17T12:00:00Z')
const noKc = () => null
const ON = { OUTREACH_METRICS: '1', CRON_SECRET: 'cron-test', OUTREACH_EVENT_SECRET: 'event-secret-test-0123456789' }

function layer(status = 'ok', contacted: (b: any) => string[] = () => []) {
  const calls: { path: string; body: any }[] = []
  const f: any = async (url: string, init: any = {}) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ path: u.pathname, body })
    if (u.pathname === '/api/outreach/check') return new Response(JSON.stringify({ contacted: contacted(body), campaign: { status, bounce_pct: 3, window_size: 100 } }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
  f.calls = calls
  return f
}

describe('send-promo outreach metrics wiring (offline)', () => {
  it('campaign is one per touch per month and a valid Resend tag; message gets tags, headers/from unchanged', () => {
    expect(dripCampaign('meetingmind', 'promo_1', NOW)).toBe('meetingmind-promo1-20261201')
    expect(dripTags('meetingmind', 'promo_2', NOW)).toEqual([{ name: 'campaign_id', value: 'meetingmind-promo2-20261201' }, { name: 'product', value: 'meetingmind' }])
    const base = { from: 'Meeting Mind <meetingmind@send.kreativekoala.llc>', to: 'a@real.org', subject: 's', html: '<body></body>' }
    const plain = buildPromoMessage(base)
    const tagged = buildPromoMessage({ ...base, tags: dripTags('meetingmind', 'promo_1', NOW) })
    expect(plain).not.toHaveProperty('tags')
    const { tags, ...rest } = tagged as any
    expect(rest).toEqual(plain)
    expect(tags[0].name).toBe('campaign_id')
    expect(tagged.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('touch 1 dedupes against the ledger (90 days); touches 2 and 3 are deliberate repeats (dedupe off)', async () => {
    expect(dripDedupeDays('promo_1', {})).toBe(90)
    expect(dripDedupeDays('promo_2', {})).toBe(0)
    expect(dripDedupeDays('promo_3', {})).toBe(0)
    const env = { OUTREACH_LEDGER_DIR: dir() }
    const om = new OutreachMetrics({ env, keychain: noKc, now: () => NOW.getTime() })
    om.ledger('meetingmind').add('meetingmind', 'seen@real.org', 'meetingmind-announce-20261113')
    const users = [{ id: '1', email: 'Seen@Real.org' }, { id: '2', email: 'new@real.org' }]
    const t1 = await screenDrip({ om, product: 'meetingmind', template: 'promo_1', users, now: NOW })
    expect(t1.allowed.map((u) => u.id)).toEqual(['2'])
    expect(t1.skippedLedger).toBe(1)
    const t2 = await screenDrip({ om, product: 'meetingmind', template: 'promo_2', users, now: NOW })
    expect(t2.allowed.map((u) => u.id)).toEqual(['1', '2'])
  })

  it('flag OFF: no network call; recordSent still writes the ledger (hashes only)', async () => {
    const f = layer()
    const env = { OUTREACH_LEDGER_DIR: dir(), CRON_SECRET: 'x', OUTREACH_EVENT_SECRET: 'y'.repeat(20) }
    const om = new OutreachMetrics({ env, fetchImpl: f, keychain: noKc })
    await screenDrip({ om, product: 'meetingmind', template: 'promo_1', users: [{ email: 'a@real.org' }], now: NOW })
    expect(await om.registerCampaign({ id: 'c', product: 'meetingmind' })).toBe(false)
    om.recordSent({ product: 'meetingmind', campaign: 'c', email: 'a@real.org' })
    expect(await om.flushEvents()).toEqual({ posted: 0, failed: 0 })
    expect(f.calls.length).toBe(0)
    expect(readFileSync(ledgerPath(env, 'meetingmind'), 'utf8')).not.toMatch(/real\.org/)
    expect(new Ledger(ledgerPath(env, 'meetingmind')).has('meetingmind', 'a@real.org', 90)).toBe(true)
  })

  it('flag ON: layer dedupe applies, breaker pause_recommended halts the batch and mid-batch check, layer failures fail open', async () => {
    const f = layer('ok', (b) => b.emails.filter((e: string) => e.startsWith('dup')))
    const om = new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: f, keychain: noKc })
    const r = await screenDrip({ om, product: 'meetingmind', template: 'promo_1', users: [{ email: 'dup@real.org' }, { email: 'ok@real.org' }], now: NOW })
    expect(r.allowed).toEqual([{ email: 'ok@real.org' }])
    expect(r.skippedLayer).toBe(1)
    expect(f.calls[0].body.campaign).toBe('meetingmind-promo1-20261201')

    const bad = new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: layer('pause_recommended'), keychain: noKc })
    const h = await screenDrip({ om: bad, product: 'meetingmind', template: 'promo_1', users: [{ email: 'a@real.org' }], now: NOW })
    expect(h.halt?.reason).toMatch(/pause_recommended/)
    expect(await breakerHalt({ om: new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: layer('pause_recommended'), keychain: noKc }), product: 'meetingmind', template: 'promo_1' })).toMatch(/pause_recommended/)

    const down = new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as any, keychain: noKc })
    const d = await screenDrip({ om: down, product: 'meetingmind', template: 'promo_1', users: [{ email: 'a@real.org' }], now: NOW })
    expect(d.allowed.length).toBe(1)
    expect(d.halt).toBeNull()
  })
})
