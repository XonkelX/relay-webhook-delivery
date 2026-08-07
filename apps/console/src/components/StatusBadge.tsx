import type { EndpointSummary, EventSummary } from '@relay/contracts'

type OperationalStatus =
  EventSummary['status'] | EndpointSummary['status'] | EndpointSummary['health'] | 'replayed'

interface StatusBadgeProps {
  status: OperationalStatus
}

const labels: Record<OperationalStatus, string> = {
  queued: 'Queued',
  leased: 'Leased',
  retrying: 'Retrying',
  delivered: 'Delivered',
  exhausted: 'Exhausted',
  cancelled: 'Cancelled',
  mixed: 'Mixed',
  no_deliveries: 'No deliveries',
  pending: 'Pending',
  active: 'Active',
  paused: 'Paused',
  disabled: 'Disabled',
  healthy: 'Healthy',
  degraded: 'Degraded',
  unknown: 'Unknown',
  replayed: 'Replayed',
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {labels[status]}
    </span>
  )
}
