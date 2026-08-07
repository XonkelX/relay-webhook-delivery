import { createMiddleware } from 'hono/factory'
import {
  readOwnerCsrfCookie,
  readOwnerSessionCookie,
  verifyOwnerCsrfToken,
  verifySignedOwnerSessionCookieValue,
} from '../lib/owner-session-http.js'
import { authenticateOwnerSession } from '../lib/owner-session.js'
import type { RelayWorkerEnvironment } from './require-api-key.js'

const CSRF_HEADER_NAME = 'X-Relay-CSRF'

function unauthorized() {
  return {
    error: {
      code: 'UNAUTHORIZED',
      message: 'A valid owner session is required.',
    },
  }
}

export const requireOwnerSession = createMiddleware<RelayWorkerEnvironment>(
  async (context, next) => {
    const signingKey = context.env.OWNER_SESSION_SIGNING_KEY

    if (!signingKey) {
      console.error('Owner session signing key is not configured.')

      context.header('Cache-Control', 'no-store')

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

    const cookieHeader = context.req.header('Cookie') ?? null

    const signedCookie = readOwnerSessionCookie(cookieHeader)

    if (!signedCookie) {
      context.header('Cache-Control', 'no-store')

      return context.json(unauthorized(), 401)
    }

    let rawToken: string | null

    try {
      rawToken = await verifySignedOwnerSessionCookieValue(signedCookie, signingKey)
    } catch (error) {
      console.error('Owner session signing configuration is invalid.', error)

      context.header('Cache-Control', 'no-store')

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

    if (!rawToken) {
      context.header('Cache-Control', 'no-store')

      return context.json(unauthorized(), 401)
    }

    const session = await authenticateOwnerSession(context.env.DB, rawToken)

    if (!session) {
      context.header('Cache-Control', 'no-store')

      return context.json(unauthorized(), 401)
    }

    const method = context.req.method.toUpperCase()

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const validCsrf = await verifyOwnerCsrfToken(
        rawToken,
        context.req.header(CSRF_HEADER_NAME) ?? null,
        readOwnerCsrfCookie(cookieHeader),
        signingKey,
      )

      if (!validCsrf) {
        context.header('Cache-Control', 'no-store')

        return context.json(
          {
            error: {
              code: 'CSRF_REJECTED',
              message: 'A valid CSRF token is required.',
            },
          },
          403,
        )
      }
    }

    context.set('ownerSession', session)
    context.set('ownerSessionRawToken', rawToken)
    context.header('Cache-Control', 'no-store')

    await next()
  },
)
