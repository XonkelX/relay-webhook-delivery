export interface EndpointFixture {
  id: string
  name: string
  url: string
  status: 'healthy' | 'degraded' | 'disabled'
  signingSecretHint: string
  successRate: number
  averageLatencyMs: number
  eventCount24h: number
  lastDeliveryAt: string
}

export const endpointFixtures: EndpointFixture[] = [
  {
    id: 'ep_orders_prod',
    name: 'Production Orders',
    url: 'https://api.example.com/webhooks/orders',
    status: 'healthy',
    signingSecretHint: 'whsec_••••••••8K2P',
    successRate: 99.98,
    averageLatencyMs: 184,
    eventCount24h: 12842,
    lastDeliveryAt: '2026-08-04T19:42:12.000Z',
  },
  {
    id: 'ep_billing',
    name: 'Billing Platform',
    url: 'https://billing.example.com/hooks/relay',
    status: 'degraded',
    signingSecretHint: 'whsec_••••••••4M7Q',
    successRate: 94.61,
    averageLatencyMs: 431,
    eventCount24h: 3921,
    lastDeliveryAt: '2026-08-04T19:42:09.000Z',
  },
  {
    id: 'ep_legacy_crm',
    name: 'Legacy CRM',
    url: 'https://crm.example.net/webhook',
    status: 'disabled',
    signingSecretHint: 'whsec_••••••••1R9V',
    successRate: 82.4,
    averageLatencyMs: 781,
    eventCount24h: 684,
    lastDeliveryAt: '2026-08-04T19:26:04.000Z',
  },
]
