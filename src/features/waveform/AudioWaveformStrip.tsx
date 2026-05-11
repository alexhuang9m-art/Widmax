import { useEffect, useRef } from 'react'

interface AudioWaveformStripProps {
  peaks: number[] | undefined
  currentTime: number
  duration: number
  onSeek: (seconds: number) => void
}

export function AudioWaveformStrip({
  peaks,
  currentTime,
  duration,
  onSeek,
}: AudioWaveformStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 1 || h < 1) return
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      const g = canvas.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)

      const padX =
        parseFloat(
          getComputedStyle(container).getPropertyValue('--tile-scrub-thumb-half').trim(),
        ) || 4.5
      const innerW = Math.max(1e-6, w - 2 * padX)

      const padY = 2
      const midY = h / 2
      const barMaxH = (h - padY * 2) / 2

      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(padX, midY - 0.5, innerW, 1)

      const list = peaks && peaks.length > 0 ? peaks : null
      const n = list ? list.length : Math.floor(innerW / 2)
      const step = innerW / Math.max(1, n)

      if (list) {
        g.fillStyle = 'rgba(180, 200, 230, 0.55)'
        for (let i = 0; i < list.length; i += 1) {
          const amp = list[i] ?? 0
          const bh = Math.max(0.5, amp * barMaxH)
          const x = padX + i * step
          const bw = Math.max(1, step * 0.72)
          g.fillRect(x, midY - bh, bw, bh)
          g.fillRect(x, midY, bw, bh)
        }
      } else {
        g.fillStyle = 'rgba(255,255,255,0.08)'
        for (let i = 0; i < n; i += 1) {
          const x = padX + i * step
          const bw = Math.max(1, step * 0.72)
          g.fillRect(x, midY - 1, bw, 2)
        }
      }

      const dur = Math.max(duration, 1e-6)
      const px = padX + (currentTime / dur) * innerW
      g.strokeStyle = 'rgba(255, 255, 255, 0.55)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(px + 0.5, 0)
      g.lineTo(px + 0.5, h)
      g.stroke()
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [peaks, currentTime, duration])

  const onPointer = (clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const padX =
      parseFloat(getComputedStyle(el).getPropertyValue('--tile-scrub-thumb-half').trim()) || 4.5
    const innerW = Math.max(1e-6, r.width - 2 * padX)
    const ratio = Math.min(1, Math.max(0, (clientX - r.left - padX) / innerW))
    onSeek(ratio * Math.max(duration, 0.01))
  }

  return (
    <div
      ref={containerRef}
      className="audio-waveform-strip"
      role="slider"
      aria-label="音轨响度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 100) / 100}
      aria-valuenow={Math.round(currentTime * 100) / 100}
      tabIndex={-1}
      onClick={(e) => onPointer(e.clientX)}
    >
      <canvas ref={canvasRef} className="audio-waveform-canvas" />
    </div>
  )
}
