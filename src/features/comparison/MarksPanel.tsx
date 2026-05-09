import type { AnnotationMark, SlotId } from '../../types/video'

interface MarksPanelProps {
  marks: AnnotationMark[]
  onJump: (time: number) => void
  onCapture: (slot: SlotId) => void
}

export function MarksPanel({ marks, onJump, onCapture }: MarksPanelProps) {
  return (
    <aside className="marks glass">
      <h3>Annotations</h3>
      <div className="capture-row">
        {[0, 1, 2, 3].map((slot) => (
          <button key={slot} className="mini-btn" onClick={() => onCapture(slot as SlotId)}>
            Snap {slot + 1}
          </button>
        ))}
      </div>
      <ul>
        {marks.length === 0 ? <li className="muted">暂无标注</li> : null}
        {marks.map((mark) => (
          <li key={mark.id}>
            <button className="mark-item" onClick={() => onJump(mark.at)}>
              <span>{mark.at.toFixed(2)}s</span>
              <small>{mark.note}</small>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
