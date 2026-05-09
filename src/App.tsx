import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoSource } from './types/video'

const DB_NAME = 'widmax-video-cache'
const STORE_NAME = 'videos'

type CachedVideo = { name: string; file: Blob }
type AlignStatus = 'idle' | 'running' | 'failed'

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|mpeg|mpg|wmv|flv|3gp|ts|m2ts|ogv)(\?.*)?$/i

function isVideoFile(file: File) {
  if (file.type.startsWith('video/')) return true
  const path = file.webkitRelativePath || file.name
  return VIDEO_EXT.test(path)
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

async function writeCachedVideos(videos: { name: string; file: File }[]) {
  const db = await openCacheDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    videos.forEach((video) => {
      store.put({ name: video.name, file: video.file })
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

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

  const selectedVideos = useMemo(() => {
    return selectedIds
      .map((id) => library.find((video) => video.id === id))
      .filter((item): item is VideoSource => Boolean(item))
  }, [library, selectedIds])

  const longestSelectedDuration = useMemo(() => {
    const maxDuration = selectedVideos.reduce((max, video) => {
      const duration = videoProgress[video.id]?.duration ?? 0
      return Math.max(max, duration)
    }, 0)
    return Math.max(0.01, maxDuration)
  }, [selectedVideos, videoProgress])

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

  const autoAlignByAudio = async () => {
    if (selectedVideos.length < 2) return
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
      const referenceVideo = videoRefs.current.get(reference.id)
      const referenceTime = referenceVideo?.currentTime ?? masterTime
      decoded.slice(1).forEach((item) => {
        const lag = bestLagSeconds(reference.sampled, item.sampled, targetRate, 10)
        const targetVideo = videoRefs.current.get(item.id)
        if (!targetVideo) return
        targetVideo.currentTime = Math.max(0, referenceTime + lag)
      })
      setAlignStatus('idle')
    } catch {
      setAlignStatus('failed')
    }
  }

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
      const master = selectedVideos[0]
      if (master) {
        const video = videoRefs.current.get(master.id)
        if (video) setMasterTime(video.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [selectedVideos])

  const handleFolderImport = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files ?? [])
    const source = fileList
      .filter((file) => isVideoFile(file))
      .map((file) => ({ name: file.webkitRelativePath || file.name, file }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    if (source.length === 0) {
      event.target.value = ''
      return
    }

    const videos = source.map((item) => ({
      id: crypto.randomUUID(),
      name: item.name,
      url: URL.createObjectURL(item.file),
      type: 'local' as const,
      blob: item.file,
    }))
    setLibrary(videos)
    setSelectedIds([])
    void writeCachedVideos(source)
    event.target.value = ''
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
    const nextTime = Math.max(0, time)
    videoRefs.current.forEach((video) => {
      video.currentTime = nextTime
    })
    setMasterTime(nextTime)
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
            <label className="mini-btn import-label">
              Import Folder
              <input
                type="file"
                multiple
                webkitdirectory=""
                directory=""
                onChange={handleFolderImport}
              />
            </label>
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
      </section>

      <section className="viewer">
        <section className="playback-row">
          {selectedVideos.map((video) => (
            <article key={video.id} className="play-tile glass">
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
                    setVideoProgress((prev) => ({
                      ...prev,
                      [video.id]: {
                        current: currentTime,
                        duration: Math.max(nativeDuration || 0, 0.01),
                      },
                    }))
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
                />
                <button
                  type="button"
                  className="video-hit-area"
                  onClick={() => toggleSinglePlayback(video.id)}
                  aria-label={`toggle ${video.name}`}
                />
              </div>
              <div className="tile-controls">
                <button className="mini-btn" onClick={() => toggleSinglePlayback(video.id)}>
                  {videoPlaying[video.id] ? 'Pause' : 'Play'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={videoProgress[video.id]?.duration ?? 0.01}
                  step={0.01}
                  value={videoProgress[video.id]?.current ?? 0}
                  onChange={(event) => seekSingle(video.id, event.target.valueAsNumber)}
                />
              </div>
            </article>
          ))}
          {selectedVideos.length === 0 ? (
            <article className="play-tile glass empty-slot">请选择左侧视频开始播放</article>
          ) : null}
        </section>

        <section className="controls glass">
          <button className="mini-btn" onClick={togglePlayback}>
            {isPlaying ? 'Pause All' : 'Play All'}
          </button>
          <button className="mini-btn" onClick={() => void autoAlignByAudio()} disabled={alignStatus === 'running'}>
            {alignStatus === 'running' ? 'Aligning...' : '自动对齐'}
          </button>
          <input
            type="range"
            min={0}
            max={longestSelectedDuration}
            step={0.01}
            value={masterTime}
            onChange={(event) => seekAll(event.target.valueAsNumber)}
          />
          <span>{masterTime.toFixed(2)}s</span>
        </section>
      </section>
    </main>
  )
}

export default App
