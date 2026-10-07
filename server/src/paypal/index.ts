import { PayPalClient, SANDBOX_BASE, PAYPAL_CERT_ORIGINS, type PayPalMode } from './client.ts'
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_WEBHOOK_ID } from './mock.ts'

let client: PayPalClient | null = null

export function paypalMode(): PayPalMode {
  const m = (process.env.PAYPAL_MODE || 'mock').toLowerCase()
  if (m === 'sandbox' && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) return 'sandbox'
  return 'mock'
}

/** Origin the API is reachable at by itself (the mock lives on the same server). */
export function selfBase() { return process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 8306}` }

export function paypal(): PayPalClient {
  if (client) return client
  const mode = paypalMode()
  client = mode === 'sandbox'
    ? new PayPalClient('sandbox', process.env.PAYPAL_API_BASE || SANDBOX_BASE, process.env.PAYPAL_CLIENT_ID!, process.env.PAYPAL_CLIENT_SECRET!)
    : new PayPalClient('mock', `${selfBase()}/mock-paypal`, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET)
  return client
}

export function webhookId() { return paypalMode() === 'sandbox' ? process.env.PAYPAL_WEBHOOK_ID || '' : MOCK_WEBHOOK_ID }

export function allowedCertOrigins() { return paypalMode() === 'sandbox' ? PAYPAL_CERT_ORIGINS : [new URL(selfBase()).origin] }

/** Public config the browser needs to load the PayPal JS SDK (or the mock buttons). */
export function publicPayPalConfig() {
  const mode = paypalMode()
  return { mode, clientId: mode === 'sandbox' ? process.env.PAYPAL_CLIENT_ID : MOCK_CLIENT_ID, intent: 'authorize', currency: 'USD' }
}
