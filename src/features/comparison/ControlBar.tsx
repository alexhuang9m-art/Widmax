import type { ChangeEvent } from 'react'
import { widmaxRangeFillStyle } from '../../core/rangeFillStyle'
import type { LayoutMode, PerformanceProfile } from '../../types/video'

interface ControlBarProps {
  layout: LayoutMode
  isPlaying: boolean
  playbackRate: number
  profile: PerformanceProfile
  masterTime: number
  onLayout: (layout: LayoutMode) => void
  onPlayToggle: () => void
  onRate: (rate: number) => void
  onSeek: (time: number) => void
  onStep: (dir: 1 | -1) => void
  onMark: () => void
}

export function ControlBar({
  layout,
  isPlaying,
  playbackRate,
  profile,
  masterTime,
  onLayout,
  onPlayToggle,
  onRate,
  onSeek,
  onStep,
  onMark,
}: ControlBarProps) {
  return (
    <section className="control-bar glass">
      <div className="group">
        <button className="mini-btn" onClick={onPlayToggle}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button className="mini-btn" onClick={() => onStep(-1)}>
          -1 frame
        </button>
        <button className="mini-btn" onClick={() => onStep(1)}>
          +1 frame
        </button>
      </div>

      <div className="group">
        {(['single', 'dual', 'quad'] as LayoutMode[]).map((item) => (
          <button
            key={item}
            className={`mini-btn ${layout === item ? 'active' : ''}`}
            onClick={() => onLayout(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="group">
        <label>
          Rate
          <select value={playbackRate} onChange={(e) => onRate(Number(e.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={2}>2.0x</option>
          </select>
        </label>
        <label>
          Time
          <input
            className="widmax-range"
            type="range"
            min={0}
            max={600}
            step={0.01}
            value={masterTime}
            style={widmaxRangeFillStyle(masterTime, 0, 600)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSeek(event.target.valueAsNumber)}
          />
        </label>
      </div>

      <div className="group">
        <button className="mini-btn" onClick={onMark}>
          Add Mark
        </button>
        <span className="profile-tag">Profile: {profile}</span>
      </div>
    </section>
  )
}
