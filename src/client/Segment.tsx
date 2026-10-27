/** Compact visible text with a full, keyboard-accessible model description. */
import { useId } from 'react'
import type { SegmentView } from './segments.ts'

const STATUS_DOT: Record<'running' | 'idle' | 'error', string> = {
  running: '#e8b339',
  idle: '#5b8def',
  error: '#e5484d',
}

export function Segment({ view }: { view: SegmentView }) {
  const descriptionId = useId()
  const described = view.description !== undefined
  return (
    <span
      className="dsb-seg"
      title={view.description}
      tabIndex={described ? 0 : undefined}
      role={described ? 'group' : undefined}
      aria-label={described ? view.text : undefined}
      aria-describedby={described ? descriptionId : undefined}
    >
      {view.state !== undefined && (
        <span className="dsb-dot" style={{ backgroundColor: STATUS_DOT[view.state] }} aria-hidden />
      )}
      {view.text}
      {described && <span id={descriptionId} className="dsb-sr-only">{view.description}</span>}
    </span>
  )
}
