import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { extractLoudnessPeaks8k } from './core/audio/waveform'
import {
  buildAlignCacheKey,
  findAlignCacheEntry,
  loadAlignCacheEntries,
  persistAlignCacheEntries,
  removeAlignCacheEntry,
  upsertAlignCacheEntry,
} from './core/align-cache'
import {
  baselineIndexLongestTieLeft,
  buildManualAlignGroupKey,
  fileSignature,
  findApplicableManualAlignEntry,
  loadManualAlignCacheEntries,
  persistManualAlignCacheEntries,
  removeManualAlignCacheEntry,
  upsertManualAlignCacheEntry,
  type ManualAlignCacheEntry,
} from './core/manual-align-cache'
import {
  measureFpsViaRequestVideoFrameCallback,
  probeVideoContainer,
  type VideoContainerProbe,
} from './core/video/containerProbe'
import { widmaxRangeFillStyle } from './core/rangeFillStyle'
import { AudioWaveformStrip } from './features/waveform/AudioWaveformStrip'
import { SettingsDialog } from './features/settings/SettingsDialog'
import type { VideoSource } from './types/video'

const DB_NAME = 'widmax-video-cache'
const STORE_NAME = 'videos'

type CachedVideo = { name: string; file: Blob }
type AlignStatus = 'idle' | 'running' | 'failed'

/** QuickTime-style clock: `m:ss` under 1h, else `h:mm:ss`. */
function formatQuickTimeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.min(seconds, 359_999)
  const s = Math.floor(total % 60)
  const m = Math.floor((total / 60) % 60)
  const h = Math.floor(total / 3600)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

interface VideoDiagnostics {
  name: string
  width: number
  height: number
  durationSec: number
  bitrateMbps: number | null
  fileSizeMB: number | null
}

type MediaProbeHud =
  | 'pending'
  | (VideoContainerProbe & { fpsSource?: 'container' | 'rvfc' })

function collectVideoDiagnostics(video: HTMLVideoElement, source: VideoSource): VideoDiagnostics {
  const width = video.videoWidth
  const height = video.videoHeight
  const durationSec = Number.isFinite(video.duration) ? video.duration : 0
  let bitrateMbps: number | null = null
  let fileSizeMB: number | null = null
  if (source.blob && durationSec > 0) {
    fileSizeMB = source.blob.size / (1024 * 1024)
    bitrateMbps = (source.blob.size * 8) / durationSec / 1_000_000
  }
  return {
    name: source.name,
    width,
    height,
    durationSec,
    bitrateMbps,
    fileSizeMB,
  }
}

function isTabToggleBlocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return Boolean(el.closest('input, textarea, select, button, a[href]'))
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={14} height={14} aria-hidden>
      <path fill="currentColor" d="M8 5v14l11-7-11-7z" />
    </svg>
  )
}

function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={14} height={14} aria-hidden>
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  )
}

function VideoInfoHud({
  video,
  diag,
  mediaProbe,
}: {
  video: VideoSource
  diag: VideoDiagnostics | undefined
  mediaProbe: MediaProbeHud | undefined
}) {
  const res =
    diag && diag.width > 0 && diag.height > 0 ? `${diag.width}×${diag.height}` : '—'
  const dur = diag && diag.durationSec > 0 ? formatQuickTimeDuration(diag.durationSec) : '—'

  let fps = '—'
  let fpsTitle = '来自容器（MP4/MOV）或播放中的帧间隔统计'
  if (mediaProbe === 'pending') {
    fps = '读取中…'
    fpsTitle = '正在解析媒体'
  } else if (mediaProbe && mediaProbe.fps != null && Number.isFinite(mediaProbe.fps)) {
    const src =
      mediaProbe.fpsSource === 'rvfc'
        ? '播放帧间隔（容器无帧率或无法解析）'
        : '容器轨道（nb_samples ÷ 时长）'
    fpsTitle = src
    const rounded =
      Math.abs(mediaProbe.fps - Math.round(mediaProbe.fps)) < 0.02
        ? String(Math.round(mediaProbe.fps))
        : mediaProbe.fps.toFixed(3).replace(/\.?0+$/, '')
    fps = `${rounded} fps`
  }

  const codec =
    mediaProbe && mediaProbe !== 'pending' && mediaProbe.codec
      ? mediaProbe.codec
      : mediaProbe === 'pending'
        ? '读取中…'
        : '—'
  const codecTitle =
    mediaProbe && mediaProbe !== 'pending' && mediaProbe.codec
      ? 'MIME codecs 参数（与 MSE SourceBuffer 一致）'
      : undefined

  const color =
    mediaProbe && mediaProbe !== 'pending' && mediaProbe.colorSpace
      ? mediaProbe.colorSpace
      : mediaProbe === 'pending'
        ? '读取中…'
        : '—'
  const colorTitle =
    mediaProbe && mediaProbe !== 'pending' && mediaProbe.colorSpace
      ? '来自 colr/nclx 或容器解析'
      : undefined

  const br =
    diag?.bitrateMbps != null && Number.isFinite(diag.bitrateMbps)
      ? `${diag.bitrateMbps.toFixed(2)} Mb/s（均）`
      : '—'
  const sz =
    diag?.fileSizeMB != null && Number.isFinite(diag.fileSizeMB)
      ? `${diag.fileSizeMB.toFixed(1)} MB`
      : '—'
  return (
    <div className="video-info-overlay" role="status" aria-label="视频媒体信息">
      <div className="video-info-title" title={video.name}>
        {video.name}
      </div>
      <dl className="video-info-dl">
        <dt>分辨率</dt>
        <dd>{res}</dd>
        <dt>时长</dt>
        <dd>{dur}</dd>
        <dt>帧率</dt>
        <dd title={fpsTitle}>{fps}</dd>
        <dt>色域</dt>
        <dd title={colorTitle}>{color}</dd>
        <dt>解码器</dt>
        <dd title={codecTitle}>{codec}</dd>
        <dt>码率</dt>
        <dd title="文件大小÷时长，容器级平均码率">{br}</dd>
        <dt>体积</dt>
        <dd>{sz}</dd>
      </dl>
    </div>
  )
}

async function openCacheDb() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readCachedVideos(): Promise<VideoSource[]> {
  const db = await openCacheDb()
  const rows = await new Promise<CachedVideo[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as CachedVideo[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return rows
    .map((row) => ({
      id: crypto.randomUUID(),
      name: row.name,
      url: URL.createObjectURL(row.file),
      type: 'local' as const,
      blob: row.file,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

const CACHE_WRITE_BATCH = 24

/** Clear store then batch-put with progress 0–1 (for UI). */
async function writeCachedVideosWithProgress(
  videos: { name: string; file: File }[],
  onProgress: (ratio: number) => void,
): Promise<void> {
  if (videos.length === 0) {
    onProgress(1)
    return
  }
  const db = await openCacheDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  let written = 0
  const total = videos.length
  for (let i = 0; i < videos.length; i += CACHE_WRITE_BATCH) {
    const slice = videos.slice(i, i + CACHE_WRITE_BATCH)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      slice.forEach((video) => {
        store.put({ name: video.name, file: video.file })
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    written += slice.length
    onProgress(written / total)
    await new Promise<void>((r) => {
      queueMicrotask(r)
    })
  }
  db.close()
}

type VideoSlotLoadState = 'loading' | 'ready' | 'error'

function App() {
  const [library, setLibrary] = useState<VideoSource[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [masterTime, setMasterTime] = useState(0)
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const [videoProgress, setVideoProgress] = useState<Record<string, { current: number; duration: number }>>(
    {},
  )
  const [videoPlaying, setVideoPlaying] = useState<Record<string, boolean>>({})
  const [alignStatus, setAlignStatus] = useState<AlignStatus>('idle')
  const [alignCacheEntries, setAlignCacheEntries] = useState(loadAlignCacheEntries)
  const [manualAlignCacheEntries, setManualAlignCacheEntries] = useState(loadManualAlignCacheEntries)
  const manualAlignAppliedForSelRef = useRef<string>('')
  const autoAlignAppliedForSelRef = useRef<string>('')
  const [alignToast, setAlignToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const showSettingsRef = useRef(false)
  const [showVideoInfoOverlay, setShowVideoInfoOverlay] = useState(false)
  const showVideoInfoOverlayRef = useRef(false)
  const [videoDiagnostics, setVideoDiagnostics] = useState<Record<string, VideoDiagnostics>>({})
  const [mediaProbeById, setMediaProbeById] = useState<Record<string, MediaProbeHud | undefined>>({})
  const mediaProbeCacheRef = useRef(
    new Map<string, VideoContainerProbe | null>(),
  )
  const [waveformPeaks, setWaveformPeaks] = useState<Record<string, number[]>>({})
  const [waveformRefreshKey, setWaveformRefreshKey] = useState(0)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [videoSlotLoadState, setVideoSlotLoadState] = useState<Record<string, VideoSlotLoadState>>({})
  const prevSelectedIdsRef = useRef<Set<string>>(new Set())
  const waveformDecodeDurRef = useRef<Record<string, number>>({})
  const waveformDecodeGenRef = useRef<Record<string, number>>({})
  const waveformInflightRef = useRef(new Set<string>())
  const videoProgressRef = useRef(videoProgress)
  const masterTimeRef = useRef(masterTime)

  useEffect(() => {
    videoProgressRef.current = videoProgress
    masterTimeRef.current = masterTime
  }, [videoProgress, masterTime])

  useEffect(() => {
    const prev = prevSelectedIdsRef.current
    const curr = new Set(selectedIds)
    setVideoSlotLoadState((map) => {
      const next = { ...map }
      for (const id of selectedIds) {
        if (!prev.has(id)) {
          const el = videoRefs.current.get(id)
          const metaReady =
            el != null &&
            Number.isFinite(el.duration) &&
            el.duration > 0 &&
            el.readyState >= 1
          if (next[id] === 'ready' || next[id] === 'error') continue
          next[id] = metaReady ? 'ready' : 'loading'
        }
      }
      for (const id of prev) {
        if (!curr.has(id)) delete next[id]
      }
      return next
    })
    prevSelectedIdsRef.current = new Set(selectedIds)
  }, [selectedIds])

  useEffect(() => {
    showVideoInfoOverlayRef.current = showVideoInfoOverlay
  }, [showVideoInfoOverlay])

  useEffect(() => {
    showSettingsRef.current = showSettings
  }, [showSettings])

  useEffect(() => {
    if (!showSettings) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings])

  useEffect(() => {
    if (!alignToast) return
    const id = window.setTimeout(() => setAlignToast(null), 2000)
    return () => window.clearTimeout(id)
  }, [alignToast])

  const selectedVideos = useMemo(() => {
    return selectedIds
      .map((id) => library.find((video) => video.id === id))
      .filter((item): item is VideoSource => Boolean(item))
  }, [library, selectedIds])

  const activeManualAlignEntry = useMemo(
    () => findApplicableManualAlignEntry(manualAlignCacheEntries, selectedVideos),
    [manualAlignCacheEntries, selectedVideos],
  )

  const manualBaselineVideoId = useMemo(() => {
    if (!activeManualAlignEntry) return null
    const v = selectedVideos.find(
      (s) => fileSignature(s) === activeManualAlignEntry.baselineSignature,
    )
    return v?.id ?? null
  }, [activeManualAlignEntry, selectedVideos])

  const longestSelectedDuration = useMemo(() => {
    if (manualBaselineVideoId) {
      const d = videoProgress[manualBaselineVideoId]?.duration ?? 0
      return Math.max(0.01, d)
    }
    const maxDuration = selectedVideos.reduce((max, video) => {
      const duration = videoProgress[video.id]?.duration ?? 0
      return Math.max(max, duration)
    }, 0)
    return Math.max(0.01, maxDuration)
  }, [selectedVideos, videoProgress, manualBaselineVideoId])

  const applyManualSeekAll = useCallback((time: number, entry: ManualAlignCacheEntry, videos: VideoSource[]) => {
    const refs = videoRefs.current
    const baseId = videos.find((v) => fileSignature(v) === entry.baselineSignature)?.id
    if (!baseId) return
    const baseEl = refs.get(baseId)
    if (!baseEl) return
    const baseCap = baseEl.duration || videoProgressRef.current[baseId]?.duration || 0.01
    const t = Math.max(0, Math.min(time, baseCap))
    baseEl.currentTime = t
    for (const v of videos) {
      if (v.id === baseId) continue
      const el = refs.get(v.id)
      if (!el) continue
      const off = entry.offsetsBySignature[fileSignature(v)] ?? 0
      const cap = el.duration || videoProgressRef.current[v.id]?.duration || 0.01
      el.currentTime = Math.max(0, Math.min(cap, t + off))
    }
    setMasterTime(t)
    setVideoProgress((prev) => {
      const next = { ...prev }
      for (const v of videos) {
        const el = refs.get(v.id)
        if (!el) continue
        const dur = prev[v.id]?.duration ?? Math.max(el.duration || 0, 0.01)
        next[v.id] = { current: el.currentTime, duration: dur }
      }
      return next
    })
  }, [])

  const createAudioContext = () => {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) throw new Error('AudioContext is not supported')
    return new Ctx()
  }

  const toMono = (buffer: AudioBuffer): Float32Array => {
    const { numberOfChannels, length } = buffer
    if (numberOfChannels === 1) return buffer.getChannelData(0).slice()
    const mono = new Float32Array(length)
    for (let c = 0; c < numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < length; i += 1) mono[i] += data[i]
    }
    for (let i = 0; i < length; i += 1) mono[i] /= numberOfChannels
    return mono
  }

  const downsample = (samples: Float32Array, sourceRate: number, targetRate: number) => {
    if (sourceRate === targetRate) return samples
    const ratio = sourceRate / targetRate
    const outLength = Math.max(1, Math.floor(samples.length / ratio))
    const out = new Float32Array(outLength)
    for (let i = 0; i < outLength; i += 1) {
      const srcPos = i * ratio
      const left = Math.floor(srcPos)
      const right = Math.min(left + 1, samples.length - 1)
      const t = srcPos - left
      out[i] = samples[left] * (1 - t) + samples[right] * t
    }
    return out
  }

  const normalize = (samples: Float32Array) => {
    let mean = 0
    for (let i = 0; i < samples.length; i += 1) mean += samples[i]
    mean /= Math.max(1, samples.length)
    let energy = 0
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] -= mean
      energy += samples[i] * samples[i]
    }
    const scale = energy > 1e-8 ? 1 / Math.sqrt(energy) : 1
    for (let i = 0; i < samples.length; i += 1) samples[i] *= scale
    return samples
  }

  const nextPowerOf2 = (value: number) => {
    let n = 1
    while (n < value) n <<= 1
    return n
  }

  const fftInPlace = (real: Float32Array, imag: Float32Array, inverse: boolean) => {
    const n = real.length
    let j = 0
    for (let i = 1; i < n; i += 1) {
      let bit = n >> 1
      while (j & bit) {
        j ^= bit
        bit >>= 1
      }
      j ^= bit
      if (i < j) {
        ;[real[i], real[j]] = [real[j], real[i]]
        ;[imag[i], imag[j]] = [imag[j], imag[i]]
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const angle = (2 * Math.PI) / len * (inverse ? 1 : -1)
      const wLenR = Math.cos(angle)
      const wLenI = Math.sin(angle)
      for (let i = 0; i < n; i += len) {
        let wR = 1
        let wI = 0
        for (let k = 0; k < len / 2; k += 1) {
          const uR = real[i + k]
          const uI = imag[i + k]
          const vR = real[i + k + len / 2] * wR - imag[i + k + len / 2] * wI
          const vI = real[i + k + len / 2] * wI + imag[i + k + len / 2] * wR
          real[i + k] = uR + vR
          imag[i + k] = uI + vI
          real[i + k + len / 2] = uR - vR
          imag[i + k + len / 2] = uI - vI

          const nextWR = wR * wLenR - wI * wLenI
          wI = wR * wLenI + wI * wLenR
          wR = nextWR
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i += 1) {
        real[i] /= n
        imag[i] /= n
      }
    }
  }

  const bestLagSeconds = (
    reference: Float32Array,
    target: Float32Array,
    sampleRate: number,
    maxLagSeconds: number,
  ) => {
    const n = Math.min(reference.length, target.length)
    const head = Math.min(n, Math.floor(sampleRate * 8))
    const maxLag = Math.min(Math.floor(head * 0.4), Math.floor(maxLagSeconds * sampleRate))
    if (head < 512 || maxLag <= 0) return 0

    const convLength = head * 2 - 1
    const fftLength = nextPowerOf2(convLength)

    const refRe = new Float32Array(fftLength)
    const refIm = new Float32Array(fftLength)
    const tgtRe = new Float32Array(fftLength)
    const tgtIm = new Float32Array(fftLength)
    refRe.set(reference.subarray(0, head))
    tgtRe.set(target.subarray(0, head))

    fftInPlace(refRe, refIm, false)
    fftInPlace(tgtRe, tgtIm, false)

    // cross-spectrum = conj(REF) * TGT
    for (let i = 0; i < fftLength; i += 1) {
      const aR = refRe[i]
      const aI = -refIm[i]
      const bR = tgtRe[i]
      const bI = tgtIm[i]
      refRe[i] = aR * bR - aI * bI
      refIm[i] = aR * bI + aI * bR
    }

    fftInPlace(refRe, refIm, true)

    let bestLag = 0
    let bestScore = -Infinity
    for (let bin = 0; bin < fftLength; bin += 1) {
      const lag = bin < fftLength / 2 ? bin : bin - fftLength
      if (Math.abs(lag) > maxLag) continue
      const score = refRe[bin]
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }
    return bestLag / sampleRate
  }

  const applyAlignLags = useCallback((videos: VideoSource[], lagsSec: number[]) => {
    const reference = videos[0]
    const referenceVideo = videoRefs.current.get(reference.id)
    const referenceTime = referenceVideo?.currentTime ?? masterTimeRef.current
    for (let i = 1; i < videos.length; i += 1) {
      const lag = lagsSec[i - 1]
      if (lag == null || !Number.isFinite(lag)) continue
      const targetVideo = videoRefs.current.get(videos[i].id)
      if (!targetVideo) continue
      targetVideo.currentTime = Math.max(0, referenceTime + lag)
    }
  }, [])

  const autoAlignByAudio = async () => {
    if (selectedVideos.length < 2) return
    if (findApplicableManualAlignEntry(manualAlignCacheEntries, selectedVideos)) return
    const cacheKey = buildAlignCacheKey(selectedVideos)
    if (!cacheKey) return
    const cached = findAlignCacheEntry(alignCacheEntries, cacheKey)
    if (cached && cached.lagsSec.length === selectedVideos.length - 1) {
      applyAlignLags(selectedVideos, cached.lagsSec)
      return
    }

    setAlignStatus('running')
    try {
      const context = createAudioContext()
      const targetRate = 8000 // Fixed at 8kHz as requested
      const decoded = await Promise.all(
        selectedVideos.map(async (video) => {
          const sourceBlob: Blob = video.blob ? video.blob : await fetch(video.url).then((res) => res.blob())
          const arrayBuffer = await sourceBlob.arrayBuffer()
          const buffer = await context.decodeAudioData(arrayBuffer.slice(0))
          const mono = toMono(buffer)
          const sampled = normalize(downsample(mono, buffer.sampleRate, targetRate))
          return { id: video.id, sampled }
        }),
      )
      await context.close()

      const reference = decoded[0]
      const lagsSec: number[] = []
      decoded.slice(1).forEach((item) => {
        const lag = bestLagSeconds(reference.sampled, item.sampled, targetRate, 10)
        lagsSec.push(lag)
      })

      applyAlignLags(selectedVideos, lagsSec)

      setAlignCacheEntries((prev) => {
        const next = upsertAlignCacheEntry(prev, {
          cacheKey,
          referenceLabel: selectedVideos[0].name,
          otherLabels: selectedVideos.slice(1).map((v) => v.name),
          lagsSec,
        })
        persistAlignCacheEntries(next)
        return next
      })
      setAlignStatus('idle')
    } catch {
      setAlignStatus('failed')
    }
  }

  const deleteAlignCacheRow = (id: string) => {
    setAlignCacheEntries((prev) => {
      const next = removeAlignCacheEntry(prev, id)
      persistAlignCacheEntries(next)
      return next
    })
  }

  const clearAlignCacheAll = () => {
    setAlignCacheEntries([])
    persistAlignCacheEntries([])
    autoAlignAppliedForSelRef.current = ''
  }

  const deleteManualAlignCacheRow = (id: string) => {
    setManualAlignCacheEntries((prev) => {
      const next = removeManualAlignCacheEntry(prev, id)
      persistManualAlignCacheEntries(next)
      return next
    })
  }

  const clearManualAlignCacheAll = () => {
    setManualAlignCacheEntries([])
    persistManualAlignCacheEntries([])
    manualAlignAppliedForSelRef.current = ''
  }

  const saveManualAlignment = () => {
    if (selectedVideos.length < 2) return
    const gk = buildManualAlignGroupKey(selectedVideos)
    if (!gk) return
    const bi = baselineIndexLongestTieLeft(selectedVideos, videoProgress)
    const baseline = selectedVideos[bi]
    const bel = videoRefs.current.get(baseline.id)
    if (!bel) return
    const t0 = bel.currentTime
    const offsetsBySignature: Record<string, number> = {}
    for (const v of selectedVideos) {
      const el = videoRefs.current.get(v.id)
      const ct = el?.currentTime ?? videoProgress[v.id]?.current ?? 0
      offsetsBySignature[fileSignature(v)] = ct - t0
    }
    manualAlignAppliedForSelRef.current = selectedIds.join(',')
    autoAlignAppliedForSelRef.current = ''
    setManualAlignCacheEntries((prev) => {
      const next = upsertManualAlignCacheEntry(prev, {
        groupCacheKey: gk,
        baselineSignature: fileSignature(baseline),
        baselineLabel: baseline.name,
        offsetsBySignature,
      })
      persistManualAlignCacheEntries(next)
      return next
    })
    setAlignToast('完成视频对齐保存')
  }

  /** 每次选中播放前：优先手动对齐缓存，否则自动对齐缓存（与按钮缓存同源）。 */
  useEffect(() => {
    const selKey = selectedIds.join(',')
    if (selectedVideos.length < 2) {
      manualAlignAppliedForSelRef.current = ''
      autoAlignAppliedForSelRef.current = ''
      return
    }

    const ready = selectedVideos.every((v) => (videoProgress[v.id]?.duration ?? 0) >= 0.01)
    if (!ready) return

    const manualEntry = findApplicableManualAlignEntry(manualAlignCacheEntries, selectedVideos)
    if (manualEntry) {
      if (manualAlignAppliedForSelRef.current === selKey) return
      manualAlignAppliedForSelRef.current = selKey
      applyManualSeekAll(0, manualEntry, selectedVideos)
      return
    }

    manualAlignAppliedForSelRef.current = ''

    const autoKey = buildAlignCacheKey(selectedVideos)
    const autoCached =
      autoKey != null ? findAlignCacheEntry(alignCacheEntries, autoKey) : undefined

    if (autoCached && autoCached.lagsSec.length === selectedVideos.length - 1) {
      if (autoAlignAppliedForSelRef.current === selKey) return
      autoAlignAppliedForSelRef.current = selKey
      applyAlignLags(selectedVideos, autoCached.lagsSec)
      const ref0 = videoRefs.current.get(selectedVideos[0].id)
      if (ref0) setMasterTime(ref0.currentTime)
      setVideoProgress((prev) => {
        const next = { ...prev }
        for (const v of selectedVideos) {
          const el = videoRefs.current.get(v.id)
          if (!el) continue
          const dur = prev[v.id]?.duration ?? Math.max(el.duration || 0, 0.01)
          next[v.id] = { current: el.currentTime, duration: dur }
        }
        return next
      })
      return
    }

    autoAlignAppliedForSelRef.current = ''
  }, [
    selectedIds,
    selectedVideos,
    videoProgress,
    manualAlignCacheEntries,
    alignCacheEntries,
    applyManualSeekAll,
    applyAlignLags,
  ])

  useEffect(() => {
    void readCachedVideos().then((videos) => {
      if (videos.length === 0) return
      setLibrary(videos)
      setSelectedIds([])
    })
  }, [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const entry = findApplicableManualAlignEntry(manualAlignCacheEntries, selectedVideos)
      const baseId = manualBaselineVideoId

      if (entry && baseId) {
        const baseEl = videoRefs.current.get(baseId)
        if (baseEl) {
          const t = baseEl.currentTime
          if (isPlaying) {
            for (const v of selectedVideos) {
              if (v.id === baseId) continue
              const el = videoRefs.current.get(v.id)
              if (!el) continue
              const off = entry.offsetsBySignature[fileSignature(v)] ?? 0
              const cap = el.duration || videoProgressRef.current[v.id]?.duration || 0.01
              const want = Math.max(0, Math.min(cap, t + off))
              if (Math.abs(el.currentTime - want) > 0.05) {
                el.currentTime = want
              }
            }
          }
          setMasterTime(t)
        }
      } else {
        const master = selectedVideos[0]
        if (master) {
          const video = videoRefs.current.get(master.id)
          if (video) setMasterTime(video.currentTime)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [selectedVideos, isPlaying, manualAlignCacheEntries, manualBaselineVideoId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      if (showSettingsRef.current) return
      if (showVideoInfoOverlayRef.current) {
        event.preventDefault()
        setShowVideoInfoOverlay(false)
        return
      }
      if (isTabToggleBlocked(event.target)) return
      event.preventDefault()
      setShowVideoInfoOverlay(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const selectedSet = new Set(selectedVideos.map((x) => x.id))
    for (const id of Object.keys(waveformDecodeDurRef.current)) {
      if (!selectedSet.has(id)) delete waveformDecodeDurRef.current[id]
    }

    for (const v of selectedVideos) {
      if (!v.blob) continue
      const dur = videoProgressRef.current[v.id]?.duration
      if (!dur || dur < 0.01) continue
      const doneDur = waveformDecodeDurRef.current[v.id]
      if (doneDur != null && Math.abs(doneDur - dur) < 0.02) continue
      if (waveformInflightRef.current.has(v.id)) continue

      const nextGen = (waveformDecodeGenRef.current[v.id] ?? 0) + 1
      waveformDecodeGenRef.current[v.id] = nextGen
      waveformInflightRef.current.add(v.id)

      void extractLoudnessPeaks8k(v.blob, dur, createAudioContext)
        .then((peaks) => {
          waveformInflightRef.current.delete(v.id)
          if (waveformDecodeGenRef.current[v.id] !== nextGen) return
          waveformDecodeDurRef.current[v.id] = dur
          setWaveformPeaks((prev) => ({ ...prev, [v.id]: peaks }))
        })
        .catch(() => {
          waveformInflightRef.current.delete(v.id)
          if (waveformDecodeGenRef.current[v.id] !== nextGen) return
          setWaveformPeaks((prev) => ({ ...prev, [v.id]: [] }))
        })
    }
  }, [selectedVideos, waveformRefreshKey])

  useEffect(() => {
    if (!showVideoInfoOverlay) return
    const refresh = () => {
      setVideoDiagnostics((prev) => {
        const next = { ...prev }
        for (const v of selectedVideos) {
          const el = videoRefs.current.get(v.id)
          if (el) next[v.id] = collectVideoDiagnostics(el, v)
        }
        return next
      })
    }
    refresh()
    const id = window.setInterval(refresh, 400)
    return () => window.clearInterval(id)
  }, [showVideoInfoOverlay, selectedVideos])

  useEffect(() => {
    let cancelled = false

    const clearRaf = requestAnimationFrame(() => {
      if (cancelled) return
      if (!showVideoInfoOverlay) {
        setMediaProbeById({})
        return
      }

      setMediaProbeById(() => {
        const init: Record<string, MediaProbeHud | undefined> = {}
        for (const v of selectedVideos) init[v.id] = 'pending'
        return init
      })

      const cache = mediaProbeCacheRef.current
      for (const v of selectedVideos) {
        void (async () => {
          const id = v.id
          let base: VideoContainerProbe = { fps: null, codec: null, colorSpace: null }
          try {
            if (v.blob) {
              const key = fileSignature(v)
              const hit = cache.get(key)
              if (hit !== undefined) {
                base = {
                  fps: hit?.fps ?? null,
                  codec: hit?.codec ?? null,
                  colorSpace: hit?.colorSpace ?? null,
                }
              } else {
                const probed = await probeVideoContainer(v.blob)
                cache.set(key, probed)
                base = probed ?? { fps: null, codec: null, colorSpace: null }
              }
            }

            if (base.fps == null) {
              const el = videoRefs.current.get(id)
              if (el && !el.paused) {
                const f = await measureFpsViaRequestVideoFrameCallback(el)
                if (f != null) {
                  if (cancelled) return
                  setMediaProbeById((prev) => ({
                    ...prev,
                    [id]: { ...base, fps: f, fpsSource: 'rvfc' },
                  }))
                  return
                }
              }
            }

            if (cancelled) return
            setMediaProbeById((prev) => ({
              ...prev,
              [id]: {
                ...base,
                ...(base.fps != null ? { fpsSource: 'container' as const } : {}),
              },
            }))
          } catch {
            if (cancelled) return
            setMediaProbeById((prev) => ({
              ...prev,
              [id]: { fps: null, codec: null, colorSpace: null },
            }))
          }
        })()
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(clearRaf)
    }
  }, [showVideoInfoOverlay, selectedVideos])

  const handleFolderImport = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const fileList = Array.from(input.files ?? [])
    const source = fileList
      .filter((file) => file.type.startsWith('video/'))
      .map((file) => ({ name: file.webkitRelativePath || file.name, file }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const run = async () => {
      if (source.length === 0) {
        input.value = ''
        return
      }
      setImportProgress(0)
      try {
        const videos: VideoSource[] = []
        const urlChunk = 12
        for (let i = 0; i < source.length; i += urlChunk) {
          const end = Math.min(i + urlChunk, source.length)
          for (let j = i; j < end; j += 1) {
            const item = source[j]
            videos.push({
              id: crypto.randomUUID(),
              name: item.name,
              url: URL.createObjectURL(item.file),
              type: 'local',
              blob: item.file,
            })
          }
          setImportProgress(end / source.length * 0.42)
          await new Promise<void>((r) => {
            requestAnimationFrame(() => r())
          })
        }
        setLibrary(videos)
        setSelectedIds([])
        mediaProbeCacheRef.current.clear()
        await writeCachedVideosWithProgress(source, (p) => {
          setImportProgress(0.42 + p * 0.58)
        })
      } catch {
        /* IndexedDB or decode failures — library may still be updated */
      } finally {
        setImportProgress(null)
        input.value = ''
      }
    }
    void run()
  }

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      return [...prev, id]
    })
  }

  const togglePlayback = () => {
    if (isPlaying) {
      videoRefs.current.forEach((video) => video.pause())
      setIsPlaying(false)
      return
    }
    videoRefs.current.forEach((video) => {
      void video.play().catch(() => undefined)
    })
    setIsPlaying(true)
  }

  const seekAll = (time: number) => {
    const entry = findApplicableManualAlignEntry(manualAlignCacheEntries, selectedVideos)
    if (entry) {
      applyManualSeekAll(time, entry, selectedVideos)
      return
    }
    const nextTime = Math.max(0, time)
    videoRefs.current.forEach((video) => {
      video.currentTime = nextTime
    })
    setMasterTime(nextTime)
    setVideoProgress((prev) => {
      const next = { ...prev }
      for (const v of selectedVideos) {
        const el = videoRefs.current.get(v.id)
        if (!el) continue
        const dur = prev[v.id]?.duration ?? Math.max(el.duration || 0, 0.01)
        next[v.id] = { current: el.currentTime, duration: dur }
      }
      return next
    })
  }

  const toggleSinglePlayback = (id: string) => {
    const video = videoRefs.current.get(id)
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => undefined)
      return
    }
    video.pause()
  }

  const seekSingle = (id: string, time: number) => {
    const video = videoRefs.current.get(id)
    if (!video) return
    video.currentTime = Math.max(0, time)
    setVideoProgress((prev) => ({
      ...prev,
      [id]: {
        current: video.currentTime,
        duration: prev[id]?.duration ?? Math.max(video.duration || 0, 0.01),
      },
    }))
  }

  return (
    <main className={`workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <section className="left-pane">
        <div className="sidebar-top">
          <button
            className="mini-btn sidebar-icon-toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
          >
            {sidebarCollapsed ? '☰' : '⟨'}
          </button>
          {!sidebarCollapsed ? <span className="sidebar-title">素材库</span> : null}
        </div>
        <aside className={`sidebar glass ${sidebarCollapsed ? 'hidden' : ''}`}>
          <div className="sidebar-actions">
            <div className="sidebar-import-block">
              <label className="import-label widmax-btn-primary widmax-btn-split">
                <span className="widmax-btn-split-main">
                  <span className="widmax-btn-split-icon" aria-hidden>
                    ✓
                  </span>
                  Import Folder
                </span>
                <span className="widmax-btn-split-sep" aria-hidden />
                <span className="widmax-btn-split-chevron" aria-hidden>
                  ∨
                </span>
                <input
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={handleFolderImport}
                />
              </label>
              {importProgress != null ? (
                <div className="import-progress-block" aria-live="polite">
                  <div className="import-progress-track">
                    <div
                      className="import-progress-fill"
                      style={{ width: `${Math.round(importProgress * 100)}%` }}
                    />
                  </div>
                  <div className="import-progress-label">导入中…</div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="video-list">
            {library.length === 0 ? <p className="muted">导入文件夹后在此选择视频</p> : null}
            {library.map((video) => (
              <label key={video.id} className="video-item">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(video.id)}
                  onChange={() => toggleSelection(video.id)}
                />
                <span title={video.name}>{video.name}</span>
              </label>
            ))}
          </div>
        </aside>
        <div className="left-pane-footer">
          <button
            type="button"
            className="mini-btn left-pane-settings-btn"
            onClick={() => setShowSettings(true)}
            aria-label="设置"
          >
            {sidebarCollapsed ? '⚙' : '设置'}
          </button>
        </div>
      </section>

      <section className="viewer">
        <section className="playback-row">
          {selectedVideos.map((video) => (
            <article key={video.id} className="play-tile glass">
              <div className="play-tile-title" title={video.name}>
                {video.name}
              </div>
              <div className="video-stage">
                <video
                  ref={(node) => {
                    if (!node) {
                      videoRefs.current.delete(video.id)
                      return
                    }
                    videoRefs.current.set(video.id, node)
                  }}
                  src={video.url}
                  playsInline
                  muted
                  disablePictureInPicture
                  controlsList="nofullscreen nodownload noplaybackrate"
                  onLoadedMetadata={(event) => {
                    const currentTime = event.currentTarget.currentTime
                    const nativeDuration = event.currentTarget.duration
                    const el = event.currentTarget
                    setVideoSlotLoadState((prev) => ({ ...prev, [video.id]: 'ready' }))
                    setVideoDiagnostics((prev) => ({
                      ...prev,
                      [video.id]: collectVideoDiagnostics(el, video),
                    }))
                    setVideoProgress((prev) => ({
                      ...prev,
                      [video.id]: {
                        current: currentTime,
                        duration: Math.max(nativeDuration || 0, 0.01),
                      },
                    }))
                    setWaveformRefreshKey((k) => k + 1)
                  }}
                  onTimeUpdate={(event) => {
                    const currentTime = event.currentTarget.currentTime
                    const nativeDuration = event.currentTarget.duration
                    setVideoProgress((prev) => ({
                      ...prev,
                      [video.id]: {
                        current: currentTime,
                        duration: prev[video.id]?.duration ?? Math.max(nativeDuration || 0, 0.01),
                      },
                    }))
                  }}
                  onPlay={() => setVideoPlaying((prev) => ({ ...prev, [video.id]: true }))}
                  onPause={() => setVideoPlaying((prev) => ({ ...prev, [video.id]: false }))}
                  onError={() => {
                    setVideoSlotLoadState((prev) => ({ ...prev, [video.id]: 'error' }))
                  }}
                />
                {videoSlotLoadState[video.id] !== 'ready' ? (
                  <div
                    className={`video-slot-loading ${videoSlotLoadState[video.id] === 'error' ? 'video-slot-loading--error' : ''}`}
                    role="status"
                    aria-live="polite"
                  >
                    {videoSlotLoadState[video.id] === 'error' ? (
                      <span className="video-slot-loading-text">无法加载视频</span>
                    ) : (
                      <>
                        <span className="video-slot-loading-text">加载中…</span>
                        <div className="video-slot-loading-track">
                          <div className="video-slot-loading-bar" />
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
                {showVideoInfoOverlay ? (
                  <VideoInfoHud
                    video={video}
                    diag={videoDiagnostics[video.id]}
                    mediaProbe={mediaProbeById[video.id]}
                  />
                ) : null}
              </div>
              <div className="tile-controls">
                <button
                  type="button"
                  className="mini-btn transport-icon-btn tile-transport"
                  onClick={() => toggleSinglePlayback(video.id)}
                  aria-label={videoPlaying[video.id] ? '暂停' : '播放'}
                >
                  {videoPlaying[video.id] ? <PauseGlyph /> : <PlayGlyph />}
                </button>
                <div
                  className="tile-waveform-cell"
                  title="音轨响度（8 kHz RMS），时间轴与下方进度条一致"
                >
                  <AudioWaveformStrip
                    peaks={waveformPeaks[video.id]}
                    currentTime={videoProgress[video.id]?.current ?? 0}
                    duration={videoProgress[video.id]?.duration ?? 0.01}
                    onSeek={(t) => seekSingle(video.id, t)}
                  />
                </div>
                <input
                  className="tile-scrub widmax-range"
                  type="range"
                  min={0}
                  max={videoProgress[video.id]?.duration ?? 0.01}
                  step={0.01}
                  value={videoProgress[video.id]?.current ?? 0}
                  style={widmaxRangeFillStyle(
                    videoProgress[video.id]?.current ?? 0,
                    0,
                    videoProgress[video.id]?.duration ?? 0.01,
                  )}
                  onChange={(event) => seekSingle(video.id, event.target.valueAsNumber)}
                />
                <span className="tile-time" aria-live="polite">
                  {formatQuickTimeDuration(videoProgress[video.id]?.current ?? 0)}
                  <span className="tile-time-sep"> / </span>
                  {formatQuickTimeDuration(videoProgress[video.id]?.duration ?? 0)}
                </span>
              </div>
            </article>
          ))}
          {selectedVideos.length === 0 ? (
            <article className="play-tile glass empty-slot">请选择左侧视频开始播放</article>
          ) : null}
        </section>

        <section className="controls glass">
          <button
            className="mini-btn"
            type="button"
            onClick={() => void autoAlignByAudio()}
            disabled={alignStatus === 'running' || Boolean(activeManualAlignEntry)}
            title={
              activeManualAlignEntry
                ? '已存在手动对齐缓存，请先在设置中删除后再使用自动对齐'
                : undefined
            }
          >
            {alignStatus === 'running' ? '对齐中…' : '自动对齐'}
          </button>
          <button
            className="mini-btn"
            type="button"
            onClick={saveManualAlignment}
            disabled={selectedVideos.length < 2}
          >
            保存对齐
          </button>
          <button
            type="button"
            className="transport-icon-btn widmax-btn-primary-icon"
            onClick={togglePlayback}
            aria-label={isPlaying ? '全部暂停' : '全部播放'}
          >
            {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          <input
            className="widmax-range"
            type="range"
            min={0}
            max={longestSelectedDuration}
            step={0.01}
            value={masterTime}
            style={widmaxRangeFillStyle(masterTime, 0, longestSelectedDuration)}
            onChange={(event) => seekAll(event.target.valueAsNumber)}
          />
          <span className="tile-time" aria-live="polite">
            {formatQuickTimeDuration(masterTime)}
            <span className="tile-time-sep"> / </span>
            {formatQuickTimeDuration(longestSelectedDuration)}
          </span>
        </section>
      </section>

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        alignCacheEntries={alignCacheEntries}
        onDeleteAlignEntry={deleteAlignCacheRow}
        onClearAlignCache={clearAlignCacheAll}
        manualAlignCacheEntries={manualAlignCacheEntries}
        onDeleteManualAlignEntry={deleteManualAlignCacheRow}
        onClearManualAlignCache={clearManualAlignCacheAll}
      />

      {alignToast ? (
        <div className="widmax-toast" role="status" aria-live="polite">
          {alignToast}
        </div>
      ) : null}
    </main>
  )
}

export default App
