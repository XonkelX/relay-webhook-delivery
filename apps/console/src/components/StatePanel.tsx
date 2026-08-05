import { uiStateFixtures, type UiStateKind } from '../data/uiStates'

interface StatePanelProps {
  kind: UiStateKind
  onAction?: () => void
}

export function StatePanel({ kind, onAction }: StatePanelProps) {
  const state = uiStateFixtures[kind]

  return (
    <section
      className={`state-panel state-panel--${kind}`}
      aria-busy={kind === 'loading'}
      aria-live="polite"
    >
      <span className="state-panel__icon" aria-hidden="true">
        {kind === 'loading' ? '…' : '!'}
      </span>

      <h2>{state.title}</h2>
      <p>{state.description}</p>

      {state.actionLabel && (
        <button className="secondary-button" type="button" onClick={onAction}>
          {state.actionLabel}
        </button>
      )}
    </section>
  )
}
