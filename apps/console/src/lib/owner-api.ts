import {
  EndpointListResponseSchema,
  EventDetailResponseSchema,
  EventListResponseSchema,
  OverviewResponseSchema,
  OwnerSessionBootstrapResponseSchema,
  ReplayDeliveryAcceptedSchema,
  SystemHealthResponseSchema,
  type EndpointListResponse,
  type EventDetailResponse,
  type EventListResponse,
  type OverviewResponse,
  type OwnerSessionBootstrapResponse,
  type ReplayDeliveryAccepted,
  type SystemHealthResponse,
} from '@relay/contracts'

export class OwnerApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'OwnerApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorEnvelope {
  error?: {
    code?: unknown
    message?: unknown
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let body: ErrorEnvelope = {}

    try {
      body = (await response.json()) as ErrorEnvelope
    } catch {
      // Preserve the generic fallback below.
    }

    const code = typeof body.error?.code === 'string' ? body.error.code : 'REQUEST_FAILED'

    const message =
      typeof body.error?.message === 'string'
        ? body.error.message
        : 'The request could not be completed.'

    throw new OwnerApiError(response.status, code, message)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`

  for (const part of document.cookie.split(';')) {
    const value = part.trim()

    if (value.startsWith(prefix)) {
      return value.slice(prefix.length)
    }
  }

  return null
}

function csrfHeaders(): HeadersInit {
  const csrf = readCookie('__Host-relay_csrf')

  if (!csrf) {
    throw new OwnerApiError(403, 'CSRF_UNAVAILABLE', 'The owner session CSRF token is unavailable.')
  }

  return {
    'X-Relay-CSRF': csrf,
  }
}

export async function createOwnerSession(token: string): Promise<OwnerSessionBootstrapResponse> {
  const body = await request('/api/owner/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })

  return OwnerSessionBootstrapResponseSchema.parse(body)
}

export async function getOwnerSession(): Promise<OwnerSessionBootstrapResponse> {
  const body = await request('/api/owner/session')

  return OwnerSessionBootstrapResponseSchema.parse(body)
}

export async function logoutOwner(): Promise<void> {
  await request('/api/owner/logout', {
    method: 'POST',
    headers: csrfHeaders(),
  })
}

export async function getOverview(): Promise<OverviewResponse> {
  const body = await request('/api/owner/overview')

  return OverviewResponseSchema.parse(body)
}

export async function getEvents(query = ''): Promise<EventListResponse> {
  const suffix = query ? `?${query}` : ''
  const body = await request(`/api/owner/events${suffix}`)

  return EventListResponseSchema.parse(body)
}

export async function getEvent(eventId: string): Promise<EventDetailResponse> {
  const body = await request(`/api/owner/events/${encodeURIComponent(eventId)}`)

  return EventDetailResponseSchema.parse(body)
}

export async function getEndpoints(): Promise<EndpointListResponse> {
  const body = await request('/api/owner/endpoints')

  return EndpointListResponseSchema.parse(body)
}

export async function getSystemHealth(): Promise<SystemHealthResponse> {
  const body = await request('/api/owner/health')

  return SystemHealthResponseSchema.parse(body)
}

export async function replayDelivery(deliveryId: string): Promise<ReplayDeliveryAccepted> {
  const body = await request(`/api/owner/deliveries/${encodeURIComponent(deliveryId)}/replay`, {
    method: 'POST',
    headers: csrfHeaders(),
  })

  return ReplayDeliveryAcceptedSchema.parse(body)
}
