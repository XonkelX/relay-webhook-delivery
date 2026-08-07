import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { createOwnerSession, getOwnerSession, logoutOwner, OwnerApiError } from '../lib/owner-api'
import { AppShell, type ConsolePage } from './AppShell'

type AuthenticationState = 'checking' | 'unauthenticated' | 'authenticated' | 'error'

interface OwnerConsoleGateProps {
  activePage: ConsolePage
  children: ReactNode
  onNavigate: (page: ConsolePage) => void
}

export function OwnerConsoleGate({ activePage, children, onNavigate }: OwnerConsoleGateProps) {
  const [state, setState] = useState<AuthenticationState>('checking')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const checkSession = useCallback(async () => {
    setState('checking')
    setMessage(null)

    try {
      await getOwnerSession()
      setState('authenticated')
    } catch (error) {
      if (error instanceof OwnerApiError && error.status === 401) {
        setState('unauthenticated')
        return
      }

      setMessage(
        error instanceof Error ? error.message : 'Owner authentication could not be checked.',
      )
      setState('error')
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!token || submitting) {
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      await createOwnerSession(token)

      setToken('')
      setState('authenticated')
    } catch (error) {
      setMessage(
        error instanceof OwnerApiError
          ? error.message
          : 'Owner authentication could not be completed.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    try {
      await logoutOwner()
    } catch (error) {
      if (!(error instanceof OwnerApiError && error.status === 401)) {
        setMessage(
          error instanceof Error ? error.message : 'The owner session could not be closed.',
        )
        return
      }
    }

    setState('unauthenticated')
    setToken('')
    setMessage(null)
  }

  if (state === 'authenticated') {
    return (
      <AppShell
        activePage={activePage}
        onNavigate={onNavigate}
        onLogout={() => void handleLogout()}
      >
        {children}
      </AppShell>
    )
  }

  if (state === 'checking') {
    return (
      <main className="owner-auth">
        <section className="owner-auth__card" aria-live="polite">
          <p className="eyebrow">Relay owner console</p>
          <h1>Checking session</h1>
          <p>Verifying the signed owner session.</p>
        </section>
      </main>
    )
  }

  if (state === 'error') {
    return (
      <main className="owner-auth">
        <section className="owner-auth__card" role="alert">
          <p className="eyebrow">Relay owner console</p>
          <h1>Console unavailable</h1>
          <p>{message ?? 'Owner authentication could not be checked.'}</p>

          <button className="primary-button" type="button" onClick={() => void checkSession()}>
            Retry
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="owner-auth">
      <section className="owner-auth__card">
        <p className="eyebrow">Relay owner console</p>
        <h1>Authenticate</h1>
        <p>Enter the bootstrap token configured for this Relay deployment.</p>

        <form className="owner-auth__form" onSubmit={(event) => void handleLogin(event)}>
          <label htmlFor="owner-bootstrap-token">Owner bootstrap token</label>

          <input
            id="owner-bootstrap-token"
            type="password"
            value={token}
            autoComplete="off"
            autoFocus
            required
            onChange={(event) => setToken(event.target.value)}
          />

          {message ? (
            <p className="owner-auth__error" role="alert">
              {message}
            </p>
          ) : null}

          <button
            className="primary-button"
            type="submit"
            disabled={submitting || token.length === 0}
          >
            {submitting ? 'Authenticating…' : 'Open console'}
          </button>
        </form>

        <p className="owner-auth__note">
          The bootstrap credential is exchanged for a short-lived signed session. This interface
          does not persist the bootstrap credential.
        </p>
      </section>
    </main>
  )
}
