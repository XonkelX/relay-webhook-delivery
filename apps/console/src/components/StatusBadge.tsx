import type { DeliveryStatus } from '../data/types'

interface StatusBadgeProps {
  status: DeliveryStatus | 'healthy' | 'degraded' | 'disabled'
}

const labels: Record<StatusBadgeProps['status'], string> = {
  queued: 'Queued',
  delivered: 'Delivered',
  retrying: 'Retrying',
  exhausted: 'Exhausted',
  replayed: 'Replayed',
  healthy: 'Healthy',
  degraded: 'Degraded',
  disabled: 'Disabled',
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {labels[status]}
    </span>
  )
}
