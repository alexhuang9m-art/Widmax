import { useMemo, useState } from 'react'
import type { RoiRect, SlotId } from '../../types/video'

interface RoiOverlayProps {
  slot: SlotId
  roi: RoiRect | null
  onChange: (slot: SlotId, roi: RoiRect | null) => void
}

export function RoiOverlay({ slot, roi, onChange }: RoiOverlayProps) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const style = useMemo(() => {
    if (!roi) return undefined
    return {
      left: `${roi.x * 100}%`,
      top: `${roi.y * 100}%`,
      width: `${roi.width * 100}%`,
      height: `${roi.height * 100}%`,
    }
  }, [roi])

  return (
    <div
      className="roi-surface"
      onPointerDown={(event) => {
        const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
        setStart({
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        })
      }}
      onPointerMove={(event) => {
        if (!start) return
        const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
        const x = (event.clientX - bounds.left) / bounds.width
        const y = (event.clientY - bounds.top) / bounds.height
        onChange(slot, {
          x: Math.min(x, start.x),
          y: Math.min(y, start.y),
          width: Math.abs(x - start.x),
          height: Math.abs(y - start.y),
        })
      }}
      onPointerUp={() => setStart(null)}
      onDoubleClick={() => onChange(slot, null)}
    >
      {roi ? <div className="roi-box" style={style} /> : null}
    </div>
  )
}
