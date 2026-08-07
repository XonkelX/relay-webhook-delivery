import { createMiddleware } from 'hono/factory'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
].join('; ')

export const securityHeaders = createMiddleware(async (context, next) => {
  context.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  context.header('X-Content-Type-Options', 'nosniff')
  context.header('X-Frame-Options', 'DENY')
  context.header('Referrer-Policy', 'no-referrer')
  context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  context.header('Cross-Origin-Opener-Policy', 'same-origin')
  context.header('Cross-Origin-Resource-Policy', 'same-origin')

  if (context.req.path.startsWith('/api/') || context.req.path.startsWith('/v1/')) {
    context.header('Cache-Control', 'no-store')
  }

  await next()
})

export const enforceSameOriginApi = createMiddleware(async (context, next) => {
  const origin = context.req.header('Origin')

  context.header('Vary', 'Origin')

  // Non-browser API clients normally send no Origin
  // header and remain supported.
  if (!origin) {
    await next()
    return
  }

  let submittedOrigin: string

  try {
    submittedOrigin = new URL(origin).origin
  } catch {
    return context.json(
      {
        error: {
          code: 'CROSS_ORIGIN_REJECTED',
          message: 'Cross-origin API requests are not allowed.',
        },
      },
      403,
    )
  }

  const requestOrigin = new URL(context.req.url).origin

  if (submittedOrigin !== requestOrigin) {
    return context.json(
      {
        error: {
          code: 'CROSS_ORIGIN_REJECTED',
          message: 'Cross-origin API requests are not allowed.',
        },
      },
      403,
    )
  }

  await next()
})
