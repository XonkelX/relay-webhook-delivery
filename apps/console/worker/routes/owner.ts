import {
  DeliveryIdSchema,
  EndpointIdSchema,
  EventIdSchema,
  OwnerEndpointStatusUpdateRequestSchema,
  OwnerEndpointSubscriptionsUpdateRequestSchema,
  OwnerSessionBootstrapRequestSchema,
} from '@relay/contracts'
import { Hono } from 'hono'
import { replaceEndpointSubscriptions } from '../lib/endpoint-persistence.js'
import { buildEndpointSecretKeyring } from '../lib/endpoint-secret-keyring.js'
import {
  resolveEndpointSigningSecret,
  rotateEndpointSigningSecret,
} from '../lib/endpoint-secret-store.js'
import { verifyEndpoint } from '../lib/endpoint-verification.js'
import { updateOwnerEndpointStatus } from '../lib/owner-endpoint-management.js'
import { listOwnerEvents, parseOwnerEventListQuery } from '../lib/owner-events.js'
import { loadOwnerEventDetail } from '../lib/owner-event-detail.js'
import { listOwnerEndpoints } from '../lib/owner-endpoints.js'
import { loadOwnerSystemHealth } from '../lib/owner-health.js'
import { loadOwnerOverview } from '../lib/owner-overview.js'
import { publishDeliveryOutbox } from '../lib/outbox-publisher.js'
import { replayDelivery } from '../lib/replay-delivery.js'
import {
  buildExpiredOwnerCookies,
  buildOwnerCsrfCookie,
  buildOwnerSessionCookie,
  createOwnerCsrfToken,
  createSignedOwnerSessionCookieValue,
} from '../lib/owner-session-http.js'
import { createOwnerSession, revokeOwnerSession } from '../lib/owner-session.js'
import { verifyOwnerBootstrapToken } from '../lib/owner-bootstrap.js'
import { requireOwnerSession } from '../middleware/require-owner-session.js'
import type { RelayWorkerEnvironment } from '../middleware/require-api-key.js'

export const ownerRoute = new Hono<RelayWorkerEnvironment>()

ownerRoute.post('/session', async (context) => {
  const bootstrapToken = context.env.OWNER_BOOTSTRAP_TOKEN
  const signingKey = context.env.OWNER_SESSION_SIGNING_KEY

  if (!bootstrapToken || !signingKey) {
    console.error('Owner bootstrap authentication is not configured.')

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Owner authentication is unavailable.',
        },
      },
      500,
    )
  }

  let request: unknown

  try {
    request = await context.req.json()
  } catch {
    request = null
  }

  const parsed = OwnerSessionBootstrapRequestSchema.safeParse(request)

  if (!parsed.success) {
    return context.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'The owner credentials are invalid.',
        },
      },
      401,
    )
  }

  let authenticated: boolean

  try {
    authenticated = await verifyOwnerBootstrapToken(parsed.data.token, bootstrapToken)
  } catch (error) {
    console.error('Owner bootstrap configuration is invalid.', error)

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Owner authentication is unavailable.',
        },
      },
      500,
    )
  }

  if (!authenticated) {
    return context.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'The owner credentials are invalid.',
        },
      },
      401,
    )
  }

  const session = await createOwnerSession(context.env.DB)

  const signedCookie = await createSignedOwnerSessionCookieValue(session.rawToken, signingKey)

  const csrf = await createOwnerCsrfToken(session.rawToken, signingKey)

  const maxAgeSeconds = Math.floor(
    (Date.parse(session.expiresAt) - Date.parse(session.createdAt)) / 1000,
  )

  context.header('Set-Cookie', buildOwnerSessionCookie(signedCookie, maxAgeSeconds), {
    append: true,
  })

  context.header('Set-Cookie', buildOwnerCsrfCookie(csrf, maxAgeSeconds), { append: true })

  return context.json(
    {
      status: 'authenticated',
      expiresAt: session.expiresAt,
    },
    201,
  )
})
ownerRoute.use('*', requireOwnerSession)
ownerRoute.get('/session', (context) => {
  const session = context.get('ownerSession')

  return context.json({
    status: 'authenticated',
    expiresAt: session.expiresAt,
  })
})

ownerRoute.get('/events', async (context) => {
  let options

  try {
    options = parseOwnerEventListQuery(context.req.url)
  } catch {
    return context.json(
      {
        error: {
          code: 'INVALID_QUERY',
          message: 'The event query parameters are invalid.',
        },
      },
      400,
    )
  }

  const result = await listOwnerEvents(context.env.DB, options)

  return context.json(result)
})

ownerRoute.get('/events/:eventId', async (context) => {
  const eventId = context.req.param('eventId')

  if (!EventIdSchema.safeParse(eventId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_EVENT_ID',
          message: 'The event identifier is invalid.',
        },
      },
      400,
    )
  }

  const result = await loadOwnerEventDetail(context.env.DB, eventId)

  if (!result) {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Event not found.',
        },
      },
      404,
    )
  }

  return context.json(result)
})
ownerRoute.get('/endpoints', async (context) => {
  const result = await listOwnerEndpoints(context.env.DB)

  return context.json(result)
})

ownerRoute.patch('/endpoints/:endpointId/status', async (context) => {
  const endpointId = context.req.param('endpointId')

  if (!EndpointIdSchema.safeParse(endpointId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_ENDPOINT_ID',
          message: 'The endpoint identifier is invalid.',
        },
      },
      400,
    )
  }

  let request: unknown

  try {
    request = await context.req.json()
  } catch {
    request = null
  }

  const parsed = OwnerEndpointStatusUpdateRequestSchema.safeParse(request)

  if (!parsed.success) {
    return context.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'The endpoint status request is invalid.',
        },
      },
      400,
    )
  }

  const result = await updateOwnerEndpointStatus(context.env.DB, endpointId, parsed.data.status)

  if (!result.ok) {
    if (result.reason === 'missing') {
      return context.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Endpoint not found.',
          },
        },
        404,
      )
    }

    return context.json(
      {
        error: {
          code: 'ENDPOINT_STATUS_INELIGIBLE',
          message: 'The endpoint cannot transition to that status.',
        },
      },
      409,
    )
  }

  return context.json(result.value)
})

ownerRoute.put('/endpoints/:endpointId/subscriptions', async (context) => {
  const endpointId = context.req.param('endpointId')

  if (!EndpointIdSchema.safeParse(endpointId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_ENDPOINT_ID',
          message: 'The endpoint identifier is invalid.',
        },
      },
      400,
    )
  }

  let request: unknown

  try {
    request = await context.req.json()
  } catch {
    request = null
  }

  const parsed = OwnerEndpointSubscriptionsUpdateRequestSchema.safeParse(request)

  if (!parsed.success) {
    return context.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'The endpoint subscriptions are invalid.',
        },
      },
      400,
    )
  }

  const result = await replaceEndpointSubscriptions(
    context.env.DB,
    endpointId,
    parsed.data.eventTypes,
  )

  if (!result.updated) {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found.',
        },
      },
      404,
    )
  }

  return context.json({
    endpointId,
    subscriptions: result.eventTypes,
  })
})

ownerRoute.post('/endpoints/:endpointId/verify', async (context) => {
  const endpointId = context.req.param('endpointId')

  if (!EndpointIdSchema.safeParse(endpointId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_ENDPOINT_ID',
          message: 'The endpoint identifier is invalid.',
        },
      },
      400,
    )
  }

  const endpoint = await context.env.DB.prepare(
    `SELECT status
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
  )
    .bind(endpointId)
    .first<{ status: string }>()

  if (!endpoint) {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found.',
        },
      },
      404,
    )
  }

  if (endpoint.status !== 'pending') {
    return context.json(
      {
        error: {
          code: 'ENDPOINT_VERIFICATION_INELIGIBLE',
          message: 'Only pending endpoints can be verified.',
        },
      },
      409,
    )
  }

  const storedSecret = await context.env.DB.prepare(
    `SELECT generation
       FROM endpoint_signing_secrets
       WHERE endpoint_id = ?
         AND state = 'active'
       LIMIT 1`,
  )
    .bind(endpointId)
    .first<{ generation: number }>()

  if (!storedSecret) {
    return context.json(
      {
        error: {
          code: 'ENDPOINT_SECRET_UNAVAILABLE',
          message: 'The endpoint does not have an active signing secret.',
        },
      },
      409,
    )
  }

  let signingSecret: string

  try {
    const keyring = buildEndpointSecretKeyring(context.env)

    signingSecret = await resolveEndpointSigningSecret(context.env.DB, endpointId, keyring)
  } catch (error) {
    console.error('Endpoint verification secret resolution failed.', error)

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Endpoint verification is unavailable.',
        },
      },
      500,
    )
  }

  const result = await verifyEndpoint(context.env.DB, endpointId, signingSecret)

  if (result.kind === 'missing') {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found.',
        },
      },
      404,
    )
  }

  if (result.kind === 'ineligible') {
    return context.json(
      {
        error: {
          code: 'ENDPOINT_VERIFICATION_INELIGIBLE',
          message: 'The endpoint is no longer eligible for verification.',
        },
      },
      409,
    )
  }

  if (result.kind === 'failed') {
    return context.json(
      {
        error: {
          code: 'ENDPOINT_VERIFICATION_FAILED',
          message: `Endpoint verification failed: ${result.reason}.`,
        },
      },
      422,
    )
  }

  return context.json({
    endpointId: result.endpointId,
    status: 'active' as const,
    verifiedAt: result.verifiedAt,
  })
})

ownerRoute.post('/endpoints/:endpointId/rotate-secret', async (context) => {
  const endpointId = context.req.param('endpointId')

  if (!EndpointIdSchema.safeParse(endpointId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_ENDPOINT_ID',
          message: 'The endpoint identifier is invalid.',
        },
      },
      400,
    )
  }

  const endpoint = await context.env.DB.prepare(
    `SELECT id
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
  )
    .bind(endpointId)
    .first<{ id: string }>()

  if (!endpoint) {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found.',
        },
      },
      404,
    )
  }

  const activeSecret = await context.env.DB.prepare(
    `SELECT generation
       FROM endpoint_signing_secrets
       WHERE endpoint_id = ?
         AND state = 'active'
       LIMIT 1`,
  )
    .bind(endpointId)
    .first<{ generation: number }>()

  if (!activeSecret) {
    return context.json(
      {
        error: {
          code: 'ENDPOINT_SECRET_UNAVAILABLE',
          message: 'The endpoint does not have an active signing secret.',
        },
      },
      409,
    )
  }

  const keyVersion = context.env.ENDPOINT_SECRET_MASTER_KEY_V2
    ? 'v2'
    : context.env.ENDPOINT_SECRET_MASTER_KEY_V1
      ? 'v1'
      : null

  if (!keyVersion) {
    console.error('Endpoint secret rotation master key is not configured.')

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Endpoint secret rotation is unavailable.',
        },
      },
      500,
    )
  }

  try {
    const keyring = buildEndpointSecretKeyring(context.env)

    const rotated = await rotateEndpointSigningSecret(
      context.env.DB,
      endpointId,
      keyVersion,
      keyring,
    )

    return context.json({
      endpointId: rotated.endpointId,
      signingSecret: rotated.rawSecret,
      generation: rotated.generation,
      rotatedAt: rotated.rotatedAt,
      previousSecretValidUntil: rotated.previousValidUntil,
    })
  } catch (error) {
    console.error('Endpoint secret rotation failed.', error)

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Endpoint secret rotation could not be completed.',
        },
      },
      500,
    )
  }
})
ownerRoute.get('/overview', async (context) => {
  const result = await loadOwnerOverview(context.env.DB)

  return context.json(result)
})

ownerRoute.get('/health', async (context) => {
  const result = await loadOwnerSystemHealth(context.env.DB)

  return context.json(result)
})
ownerRoute.post('/deliveries/:deliveryId/replay', async (context) => {
  const deliveryId = context.req.param('deliveryId')

  if (!DeliveryIdSchema.safeParse(deliveryId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_DELIVERY_ID',
          message: 'The delivery identifier is invalid.',
        },
      },
      400,
    )
  }

  const result = await replayDelivery(context.env.DB, deliveryId)

  if (!result.ok) {
    if (result.reason === 'missing') {
      return context.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Delivery not found.',
          },
        },
        404,
      )
    }

    if (result.reason === 'source_not_terminal') {
      return context.json(
        {
          error: {
            code: 'DELIVERY_NOT_REPLAYABLE',
            message: 'Only terminal deliveries can be replayed.',
          },
        },
        409,
      )
    }

    return context.json(
      {
        error: {
          code: 'ENDPOINT_INACTIVE',
          message: 'The endpoint must be active before replaying a delivery.',
        },
      },
      409,
    )
  }

  await publishDeliveryOutbox(
    context.env.DB,
    context.env.DELIVERY_QUEUE,
    result.value.deliveryId,
    result.value.createdAt,
  )

  return context.json(result.value, 202)
})
ownerRoute.post('/logout', async (context) => {
  const rawToken = context.get('ownerSessionRawToken')

  await revokeOwnerSession(context.env.DB, rawToken)

  const headers = new Headers()
  headers.set('Cache-Control', 'no-store')

  for (const cookie of buildExpiredOwnerCookies()) {
    headers.append('Set-Cookie', cookie)
  }

  return new Response(null, {
    status: 204,
    headers,
  })
})
