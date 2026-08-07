import type { ReactNode } from 'react'

export type ConsolePage = 'overview' | 'events' | 'endpoints' | 'failure-lab' | 'health'

interface AppShellProps {
  activePage: ConsolePage
  children: ReactNode
  onNavigate: (page: ConsolePage) => void
  onLogout: () => void
}

const navigation: Array<{
  page: ConsolePage
  label: string
}> = [
  { page: 'overview', label: 'Overview' },
  { page: 'events', label: 'Event stream' },
  { page: 'endpoints', label: 'Endpoints' },
  { page: 'failure-lab', label: 'Failure Lab' },
  { page: 'health', label: 'System health' },
]

export function AppShell({ activePage, children, onNavigate, onLogout }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            R
          </span>
          <div>
            <strong>Relay</strong>
            <span>Webhook delivery</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const isActive = activePage === item.page

            return (
              <button
                key={item.page}
                className={isActive ? 'nav-item nav-item--active' : 'nav-item'}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onNavigate(item.page)}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__environment">
            <span className="environment-dot" aria-hidden="true" />
            Owner console
          </div>

          <button className="sidebar__logout" type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
