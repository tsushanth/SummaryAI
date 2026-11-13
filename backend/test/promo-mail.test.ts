import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPromoMessage, filterRecipients, injectFooter } from '../scripts/lib/promo-mail.mjs'
import { loadSuppressions, unsubscribeUrl } from '../scripts/lib/unsubscribe.mjs'

const V = JSON.parse(readFileSync(new URL('./unsubscribe-vectors.json', import.meta.url), 'utf8'))
const saved = process.env.UNSUB_SECRET

beforeAll(() => { process.env.UNSUB_SECRET = V.secret })
afterAll(() => { if (saved === undefined) delete process.env.UNSUB_SECRET; else process.env.UNSUB_SECRET = saved })

describe('send-promo unsubscribe wiring (offline)', () => {
  it('helper copy reproduces the shared golden vectors', () => {
    for (const v of V.vectors) expect(unsubscribeUrl(v.email, v.list)).toBe(v.url)
  })

  it('every promo message carries the signed footer and both one-click headers', () => {
    const html = '<html><body><p>Hi</p><div>old footer</div></body></html>'
    const m = buildPromoMessage({ from: 'Meeting Mind <meetingmind@send.kreativekoala.llc>', to: 'Alice@Example.com', subject: 's', html })
    const url = unsubscribeUrl('alice@example.com', 'mm')
    expect(m.headers['List-Unsubscribe']).toBe(`<${url}>, <mailto:t.sushanth@gmail.com?subject=unsubscribe>`)
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(m.html).toContain(`href="${url.replace(/&/g, '&amp;')}"`)
    expect(m.html).toContain('Unsubscribe</a>')
    expect(m.html).toContain('5900 Balcones Dr')
    expect(m.html.indexOf('Unsubscribe</a>')).toBeLessThan(m.html.toLowerCase().lastIndexOf('</body>'))
  })

  it('refuses to build a message when UNSUB_SECRET is missing (no unsigned sends)', () => {
    const s = process.env.UNSUB_SECRET
    delete process.env.UNSUB_SECRET
    try {
      expect(() => buildPromoMessage({ from: 'a', to: 'a@b.co', subject: 's', html: '<body></body>' })).toThrow(/UNSUB_SECRET/)
    } finally { process.env.UNSUB_SECRET = s }
  })

  it('injectFooter appends when there is no </body>', () => {
    expect(injectFooter('<p>x</p>', '<f/>')).toBe('<p>x</p><f/>')
  })

  it('a suppressed address is dropped, as are Apple relay and empty addresses', () => {
    const users = [
      { id: '1', email: 'keep@real.org' },
      { id: '2', email: 'Gone@Real.org' },
      { id: '3', email: 'x@privaterelay.appleid.com' },
      { id: '4', email: null },
    ]
    const { allowed, counts } = filterRecipients(users, new Set(['gone@real.org']))
    expect(allowed.map((u) => u.id)).toEqual(['1'])
    expect(counts).toEqual({ candidates: 4, suppressed: 1, relay: 1, no_email: 1 })
  })

  it('suppression read fails closed (nothing would be sent)', async () => {
    const bad = async () => new Response('nope', { status: 500 })
    await expect(loadSuppressions({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: bad as any })).rejects.toThrow(/refusing to send/)
  })
})
