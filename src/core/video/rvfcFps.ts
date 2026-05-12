/** When container FPS unavailable: derive constant frame interval from decoded frames (playing video). */
export function measureFpsViaRequestVideoFrameCallback(
  video: HTMLVideoElement,
  sampleFrames = 64,
): Promise<number | null> {
  const rvfc = video.requestVideoFrameCallback?.bind(video)
  const cancel = video.cancelVideoFrameCallback?.bind(video)
  if (!rvfc || !cancel) return Promise.resolve(null)

  return new Promise((resolve) => {
    let lastMediaTime = -1
    let lastPresented = -1
    const inst: number[] = []
    let n = 0
    let lastHandle = 0
    let settled = false

    const finish = (v: number | null) => {
      if (settled) return
      settled = true
      try {
        if (lastHandle) cancel(lastHandle)
      } catch {
        /* ignore */
      }
      resolve(v)
    }

    const snapCommonFps = (f: number): number => {
      const pairs: [number, number][] = [
        [23.976, 23.976],
        [23.98, 23.976],
        [24, 24],
        [25, 25],
        [29.97, 29.97],
        [30, 30],
        [47.952, 47.952],
        [48, 48],
        [50, 50],
        [59.94, 59.94],
        [60, 60],
        [120, 120],
      ]
      for (const [c, out] of pairs) {
        if (Math.abs(f - c) < 0.08) return out
      }
      return Math.round(f * 1000) / 1000
    }

    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      n += 1
      if (lastMediaTime >= 0 && meta.mediaTime > lastMediaTime + 1e-9) {
        const dMedia = meta.mediaTime - lastMediaTime
        const dFrames = meta.presentedFrames - lastPresented
        if (dFrames > 0 && dMedia > 1e-6) {
          const f = dFrames / dMedia
          if (Number.isFinite(f) && f >= 1 && f <= 240) inst.push(f)
        }
      }
      lastMediaTime = meta.mediaTime
      lastPresented = meta.presentedFrames

      if (n >= sampleFrames + 4) {
        if (inst.length < 8) {
          finish(null)
          return
        }
        inst.sort((a, b) => a - b)
        const mid = inst[Math.floor(inst.length / 2)]!
        finish(snapCommonFps(mid))
        return
      }
      lastHandle = rvfc(onFrame)
    }

    lastHandle = rvfc(onFrame)
    window.setTimeout(() => finish(null), 2500)
  })
}
