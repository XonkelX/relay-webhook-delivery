export type UiStateKind = 'empty' | 'loading' | 'error' | 'quota' | 'disabled'

export interface UiStateFixture {
  kind: UiStateKind
  title: string
  description: string
  actionLabel?: string
}

export const uiStateFixtures: Record<UiStateKind, UiStateFixture> = {
  empty: {
    kind: 'empty',
    title: 'No webhook events yet',
    description:
      'Send a test event or connect an application to begin inspecting delivery activity.',
    actionLabel: 'Send test event',
  },
  loading: {
    kind: 'loading',
    title: 'Loading delivery activity',
    description: 'Relay is retrieving the latest events and delivery attempts.',
  },
  error: {
    kind: 'error',
    title: 'Delivery activity is unavailable',
    description:
      'Relay could not load this data. Existing deliveries continue running in the background.',
    actionLabel: 'Try again',
  },
  quota: {
    kind: 'quota',
    title: 'Daily event quota reached',
    description: 'New demo events are paused until the daily usage window resets.',
  },
  disabled: {
    kind: 'disabled',
    title: 'Endpoint is disabled',
    description: 'Relay will not schedule new deliveries for this endpoint until it is re-enabled.',
    actionLabel: 'Review endpoint',
  },
}
