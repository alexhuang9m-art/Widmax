import type { ChangeEvent } from 'react'
import { RoiOverlay } from '../annotation/RoiOverlay'
import type { PerfStats } from './types'
import type { RoiRect, SlotId, VideoSource } from '../../types/video'

interface VideoTileProps {
  slot: SlotId
  source: VideoSource | null
  locked: boolean
  roi: RoiRect | null
  stats: PerfStats
  blurStrength: number
  registerVideo: (slot: SlotId, node: HTMLVideoElement | null) => void
  onUpload: (slot: SlotId, event: ChangeEvent<HTMLInputElement>) => void
  onToggleLock: (slot: SlotId) => void
  onRoiChange: (slot: SlotId, roi: RoiRect | null) => void
}

export function VideoTile({
  slot,
  source,
  locked,
  roi,
  stats,
  blurStrength,
  registerVideo,
  onUpload,
  onToggleLock,
  onRoiChange,
}: VideoTileProps) {
  return (
    <article className="video-tile glass" style={{ ['--tile-blur' as string]: `${blurStrength}px` }}>
      <header className="tile-head">
        <strong>View {slot + 1}</strong>
        <button className="mini-btn" onClick={() => onToggleLock(slot)}>
          {locked ? 'Locked' : 'Free'}
        </button>
      </header>
      {source ? (
        <div className="video-shell">
          <video ref={(node) => registerVideo(slot, node)} src={source.url} muted playsInline />
          <RoiOverlay slot={slot} roi={roi} onChange={onRoiChange} />
        </div>
      ) : (
        <label className="drop-zone">
          <input
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
            type="file"
            onChange={(event) => onUpload(slot, event)}
          />
          <span>导入 4K 素材</span>
        </label>
      )}
      <footer className="tile-stats">
        <span>{stats.fps.toFixed(1)} fps</span>
        <span>drop {stats.droppedFrames}</span>
      </footer>
    </article>
  )
}
