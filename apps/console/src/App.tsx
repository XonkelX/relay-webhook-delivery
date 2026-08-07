import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import type { ConsolePage } from './components/AppShell'
import { OwnerConsoleGate } from './components/OwnerConsoleGate'
import { eventFixtures } from './data/events'
import type { EventFixture } from './data/types'
import { DeliveryInspectorPage } from './pages/DeliveryInspectorPage'
import { EndpointsPage } from './pages/EndpointsPage'
import { EventStreamPage } from './pages/EventStreamPage'
import { FailureLabPage } from './pages/FailureLabPage'
import { LandingPage } from './pages/LandingPage'
import { OverviewPage } from './pages/OverviewPage'
import { SystemHealthPage } from './pages/SystemHealthPage'
import './App.css'

const pathsByPage: Record<ConsolePage, string> = {
  overview: '/console',
  events: '/console/events',
  endpoints: '/console/endpoints',
  'failure-lab': '/console/failure-lab',
  health: '/console/health',
}

function getActivePage(pathname: string): ConsolePage {
  if (pathname.startsWith('/console/events')) return 'events'
  if (pathname.startsWith('/console/endpoints')) return 'endpoints'
  if (pathname.startsWith('/console/failure-lab')) return 'failure-lab'
  if (pathname.startsWith('/console/health')) return 'health'

  return 'overview'
}

function ConsoleLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <OwnerConsoleGate
      activePage={getActivePage(location.pathname)}
      onNavigate={(page) => navigate(pathsByPage[page])}
    >
      <Outlet />
    </OwnerConsoleGate>
  )
}

function EventStreamRoute() {
  const navigate = useNavigate()

  function inspectEvent(event: EventFixture) {
    navigate(`/console/events/${event.id}`)
  }

  return <EventStreamPage onSelectEvent={inspectEvent} />
}

function DeliveryInspectorRoute() {
  const navigate = useNavigate()
  const { eventId } = useParams()

  const event = eventFixtures.find((fixture) => fixture.id === eventId)

  if (!event) {
    return <Navigate to="/console/events" replace />
  }

  return <DeliveryInspectorPage event={event} onBack={() => navigate('/console/events')} />
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route path="/console" element={<ConsoleLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="events" element={<EventStreamRoute />} />
        <Route path="events/:eventId" element={<DeliveryInspectorRoute />} />
        <Route path="endpoints" element={<EndpointsPage />} />
        <Route path="failure-lab" element={<FailureLabPage />} />
        <Route path="health" element={<SystemHealthPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
