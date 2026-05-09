import { useEffect, useMemo, useRef } from 'react'
import { useLabStore } from '../../store/useLabStore'
import type { SlotId } from '../../types/video'

type VideoMap = Map<SlotId, HTMLVideoElement>

const SLOT_IDS: SlotId[] = [0, 1, 2, 3]

export function usePlaybackEngine() {
  const videosRef = useRef<VideoMap>(new Map())
  const rafRef = useRef<number | null>(null)
  const frameHandles = useRef<Map<SlotId, number>>(new Map())

  const isPlaying = useLabStore((s) => s.isPlaying)
  const masterTime = useLabStore((s) => s.masterTime)
  const playbackRate = useLabStore((s) => s.playbackRate)
  const slots = useLabStore((s) => s.slots)
  const setMasterTime = useLabStore((s) => s.setMasterTime)
  const updateStats = useLabStore((s) => s.updateStats)

  const register = useMemo(
    () => (slot: SlotId, node: HTMLVideoElement | null) => {
      if (!node) {
        videosRef.current.delete(slot)
        return
      }
      videosRef.current.set(slot, node)
      node.playbackRate = playbackRate
    },
    [playbackRate],
  )

  useEffect(() => {
    videosRef.current.forEach((video) => {
      video.playbackRate = playbackRate
    })
  }, [playbackRate])

  useEffect(() => {
    const videos = videosRef.current
    const handles = frameHandles.current
    videos.forEach((video, slot) => {
      const cb = () => {
        const quality = video.getVideoPlaybackQuality?.()
        if (quality) {
          const decoded = quality.totalVideoFrames - quality.droppedVideoFrames
          const fps = decoded > 0 ? decoded / Math.max(video.currentTime, 0.001) : 0
          updateStats(slot, {
            fps: Math.min(60, fps),
            droppedFrames: quality.droppedVideoFrames,
            decodeLatencyMs: Math.max(
              0,
              (performance.now() - quality.creationTime) / 1000,
            ),
          })
        }
        const next = video.requestVideoFrameCallback(cb)
        handles.set(slot, next)
      }
      const handle = video.requestVideoFrameCallback(cb)
      handles.set(slot, handle)
    })

    return () => {
      videos.forEach((video, slot) => {
        const handle = handles.get(slot)
        if (handle !== undefined) {
          video.cancelVideoFrameCallback(handle)
        }
      })
      handles.clear()
    }
  }, [slots, updateStats])

  useEffect(() => {
    if (!isPlaying) {
      videosRef.current.forEach((video) => {
        video.pause()
      })
      return
    }
    videosRef.current.forEach((video) => {
      void video.play().catch(() => undefined)
    })
  }, [isPlaying])

  useEffect(() => {
    const tick = () => {
      const master = videosRef.current.get(0)
      if (master) {
        setMasterTime(master.currentTime)
      }
      SLOT_IDS.forEach((slot) => {
        const video = videosRef.current.get(slot)
        if (!video) return
        const slotState = slots[slot]
        if (!slotState.locked || slot === 0) return
        const drift = video.currentTime - masterTime
        if (Math.abs(drift) > 0.016) {
          video.currentTime = masterTime
        }
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [masterTime, setMasterTime, slots])

  const seekAll = (time: number) => {
    videosRef.current.forEach((video) => {
      video.currentTime = Math.max(0, time)
    })
    setMasterTime(Math.max(0, time))
  }

  const stepFrame = (direction: 1 | -1) => {
    const frameTime = 1 / Math.max(1, playbackRate * 30)
    seekAll(masterTime + direction * frameTime)
  }

  const captureFrame = (slot: SlotId): string | null => {
    const video = videosRef.current.get(slot)
    if (!video) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }

  return {
    register,
    seekAll,
    stepFrame,
    captureFrame,
  }
}
