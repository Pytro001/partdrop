// PayPal REST client: OAuth2, Orders v2 (intent AUTHORIZE), Payments v2 (capture, void),
// Payouts v1 and webhook signature verification. The same code talks to the real sandbox
// (https://api-m.sandbox.paypal.com) or to the local mock (server/src/paypal/mock.ts),
// only the base URL and credentials change.
import { X509Certificate, verify as rsaVerify } from 'node:crypto'
import { crc32 } from 'node:zlib'

export type PayPalMode = 'sandbox' | 'mock'

export interface Money { currency_code: string; value: string }
export interface Link { href: string; rel: string; method: string }

export interface PayPalOrder {
  id: string
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED'
  intent: 'CAPTURE' | 'AUTHORIZE'
  purchase_units: {
    reference_id?: string
    description?: string
    custom_id?: string
    invoice_id?: string
    amount: Money
    payments?: { authorizations?: Authorization[]; captures?: Capture[] }
  }[]
  payer?: { email_address?: string; payer_id?: string; name?: { given_name?: string; surname?: string } }
  payment_source?: Record<string, unknown>
  create_time?: string
  update_time?: string
  links: Link[]
}

export interface Authorization {
  id: string
  status: 'CREATED' | 'CAPTURED' | 'DENIED' | 'PARTIALLY_CAPTURED' | 'VOIDED' | 'PENDING'
  amount: Money
  invoice_id?: string
  custom_id?: string
  seller_protection?: { status: string; dispute_categories?: string[] }
  expiration_time?: string
  create_time?: string
  update_time?: string
  links: Link[]
}

export interface Capture {
  id: string
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED'
  amount: Money
  final_capture?: boolean
  invoice_id?: string
  seller_receivable_breakdown?: { gross_amount: Money; paypal_fee: Money; net_amount: Money }
  create_time?: string
  update_time?: string
  links: Link[]
}

export interface PayoutBatch {
  batch_header: {
    payout_batch_id: string
    batch_status: 'DENIED' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'CANCELED'
    sender_batch_header: { sender_batch_id: string; email_subject?: string; email_message?: string }
    time_created?: string
    time_completed?: string
    amount?: { currency: string; value: string }
    fees?: { currency: string; value: string }
  }
  items?: {
    payout_item_id: string
    transaction_id?: string
    transaction_status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNCLAIMED' | 'RETURNED' | 'ONHOLD' | 'BLOCKED' | 'REFUNDED' | 'REVERSED'
    payout_batch_id: string
    payout_item: { recipient_type: string; amount: { currency: string; value: string }; receiver: string; note?: string; sender_item_id?: string }
    time_processed?: string
  }[]
  links: Link[]
}

export class PayPalError extends Error {
  constructor(public status: number, public body: any) {
    super(`PayPal ${status}: ${body?.name ?? ''} ${body?.details?.[0]?.issue ?? body?.message ?? ''}`.trim())
  }
}

export class PayPalClient {
  private token: { value: string; exp: number } | null = null
  constructor(readonly mode: PayPalMode, readonly base: string, private clientId: string, private secret: string) {}

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.secret}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    const j = await res.json() as any
    if (!res.ok) throw new PayPalError(res.status, j)
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 }
    return this.token.value
  }

  async call<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    const j = text ? JSON.parse(text) : undefined
    if (!res.ok) throw new PayPalError(res.status, j)
    return j as T
  }

  /** Orders v2: create with intent AUTHORIZE. Funds are only held once the order is authorized. */
  createOrder(p: { reference_id: string; description: string; custom_id: string; invoice_id: string; total: number; item: { name: string; sku: string; description: string }; vault_id?: string }, requestId: string) {
    const value = p.total.toFixed(2)
    const body: Record<string, unknown> = {
      intent: 'AUTHORIZE',
      purchase_units: [{
        reference_id: p.reference_id,
        description: p.description.slice(0, 127),
        custom_id: p.custom_id,
        invoice_id: p.invoice_id,
        amount: { currency_code: 'USD', value, breakdown: { item_total: { currency_code: 'USD', value } } },
        items: [{ name: p.item.name.slice(0, 127), sku: p.item.sku, description: p.item.description.slice(0, 127), quantity: '1', category: 'PHYSICAL_GOODS', unit_amount: { currency_code: 'USD', value } }],
      }],
    }
    // A buyer agent pays with a vaulted PayPal wallet the human saved earlier (merchant initiated).
    if (p.vault_id) body.payment_source = { paypal: { vault_id: p.vault_id } }
    return this.call<PayPalOrder>('POST', '/v2/checkout/orders', body, { 'paypal-request-id': requestId })
  }

  getOrder(id: string) { return this.call<PayPalOrder>('GET', `/v2/checkout/orders/${id}`) }

  authorizeOrder(id: string, requestId: string) {
    return this.call<PayPalOrder>('POST', `/v2/checkout/orders/${id}/authorize`, {}, { 'paypal-request-id': requestId })
  }

  getAuthorization(id: string) { return this.call<Authorization>('GET', `/v2/payments/authorizations/${id}`) }

  captureAuthorization(id: string, p: { amount: number; invoice_id: string; note_to_payer: string }, requestId: string) {
    return this.call<Capture>('POST', `/v2/payments/authorizations/${id}/capture`, {
      amount: { currency_code: 'USD', value: p.amount.toFixed(2) },
      invoice_id: p.invoice_id,
      final_capture: true,
      note_to_payer: p.note_to_payer.slice(0, 255),
    }, { 'paypal-request-id': requestId })
  }

  voidAuthorization(id: string, requestId: string) {
    return this.call<Authorization | undefined>('POST', `/v2/payments/authorizations/${id}/void`, undefined, { 'paypal-request-id': requestId })
  }

  /** Payouts v1: pay the shop from the platform balance. */
  createPayout(p: { sender_batch_id: string; receiver: string; amount: number; note: string; sender_item_id: string }) {
    return this.call<PayoutBatch>('POST', '/v1/payments/payouts', {
      sender_batch_header: { sender_batch_id: p.sender_batch_id, email_subject: 'You have a payout for a PartDrop job', email_message: p.note },
      items: [{ recipient_type: 'EMAIL', amount: { value: p.amount.toFixed(2), currency: 'USD' }, note: p.note, sender_item_id: p.sender_item_id, receiver: p.receiver }],
    })
  }

  getPayout(batchId: string) { return this.call<PayoutBatch>('GET', `/v1/payments/payouts/${batchId}`) }

  /** Postback verification, as an alternative to the offline check below. */
  verifyWebhookPostback(h: WebhookHeaders, webhookId: string, event: unknown) {
    return this.call<{ verification_status: 'SUCCESS' | 'FAILURE' }>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h.authAlgo, cert_url: h.certUrl, transmission_id: h.transmissionId, transmission_sig: h.transmissionSig,
      transmission_time: h.transmissionTime, webhook_id: webhookId, webhook_event: event,
    })
  }
}

export interface WebhookHeaders {
  transmissionId: string
  transmissionTime: string
  transmissionSig: string
  certUrl: string
  authAlgo: string
}

export function webhookHeaders(get: (k: string) => string | undefined): WebhookHeaders | null {
  const h = {
    transmissionId: get('paypal-transmission-id') ?? '',
    transmissionTime: get('paypal-transmission-time') ?? '',
    transmissionSig: get('paypal-transmission-sig') ?? '',
    certUrl: get('paypal-cert-url') ?? '',
    authAlgo: get('paypal-auth-algo') ?? get('paypal-transmission-algo') ?? 'SHA256withRSA',
  }
  return h.transmissionId && h.transmissionSig && h.certUrl ? h : null
}

/** The string PayPal signs: transmissionId|timeStamp|webhookId|crc32(raw body) in decimal. */
export function signedMessage(h: Pick<WebhookHeaders, 'transmissionId' | 'transmissionTime'>, webhookId: string, rawBody: Buffer) {
  return `${h.transmissionId}|${h.transmissionTime}|${webhookId}|${crc32(rawBody) >>> 0}`
}

const certCache = new Map<string, string>()

/**
 * Offline verification (SHA256withRSA over the signed message with the public key of the
 * certificate at paypal-cert-url). Only certificates from PayPal hosts, or the local mock
 * in mock mode, are accepted.
 */
export async function verifyWebhookOffline(h: WebhookHeaders, webhookId: string, rawBody: Buffer, allowedCertOrigins: string[]) {
  const url = new URL(h.certUrl)
  const okHost = allowedCertOrigins.some(o => url.origin === o)
  if (!okHost) return { ok: false, reason: `cert host ${url.host} not allowed` }
  if (h.authAlgo !== 'SHA256withRSA') return { ok: false, reason: `unsupported algo ${h.authAlgo}` }
  let pem = certCache.get(h.certUrl)
  if (!pem) {
    const r = await fetch(h.certUrl)
    if (!r.ok) return { ok: false, reason: `cert fetch ${r.status}` }
    pem = await r.text()
    certCache.set(h.certUrl, pem)
  }
  const cert = new X509Certificate(pem)
  const now = Date.now()
  if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) return { ok: false, reason: 'cert expired' }
  const ok = rsaVerify('sha256', Buffer.from(signedMessage(h, webhookId, rawBody)), cert.publicKey, Buffer.from(h.transmissionSig, 'base64'))
  return { ok, reason: ok ? 'signature valid' : 'signature mismatch' }
}

export const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'
export const PAYPAL_CERT_ORIGINS = ['https://api.paypal.com', 'https://api.sandbox.paypal.com', 'https://api-m.paypal.com', 'https://api-m.sandbox.paypal.com']
