/**
 * Video technical metadata via **WebAssembly** (MediaInfoLib, `mediainfo.js`).
 * Single serialized queue: one WASM `MediaInfo` instance, analyses run one at a time.
 */

import mediaInfoFactory from 'mediainfo.js'
import type { GeneralTrack, MediaInfo, MediaInfoResult, VideoTrack } from 'mediainfo.js'
import wasmUrl from 'mediainfo.js/MediaInfoModule.wasm?url'

/** `ReturnType<typeof mediaInfoFactory>` resolves to `void` (callback overload); use explicit format. */
type MediaInfoObject = MediaInfo<'object'>

const MAX_BYTES = 450 * 1024 * 1024

export interface VideoWasmMetadata {
  /** 文件体积（MB） */
  fileSizeMb: string | null
  /** 时长（秒，用于内部；展示用外层 format） */
  durationSec: number | null
  /** 总码率（Mb/s） */
  totalBitrateMbps: string | null
  /** 编码器简述：AVC / HEVC / AV1 … + profile */
  codec: string | null
  /** 帧率数值（Hz），无则 null */
  frameRateHz: number | null
  /** 固定 / 可变 */
  frameRateMode: string | null
  /** 分辨率 */
  resolution: string | null
  /** 4:2:0 / 4:4:4 … */
  chromaSubsampling: string | null
  /** 8 bit / 10 bit … */
  bitDepth: string | null
  /** 色域基色（如 BT.709） */
  colorPrimaries: string | null
  /** 传输特性 */
  transferCharacteristics: string | null
  /** 矩阵系数 */
  matrixCoefficients: string | null
  /** Limited / Full 等 */
  colorRange: string | null
  /** 帧率来源：WASM 或 RVFC 回退 */
  fpsSource: 'wasm' | 'rvfc'
}

let mediaInfoPromise: Promise<MediaInfoObject> | null = null
let runQueue: Promise<unknown> = Promise.resolve()

function getMediaInfo(): Promise<MediaInfoObject> {
  if (!mediaInfoPromise) {
    mediaInfoPromise = mediaInfoFactory({
      format: 'object',
      full: true,
      chunkSize: 512 * 1024,
      locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path),
    })
  }
  return mediaInfoPromise
}

function withAnalyzeLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = runQueue.then(fn, fn)
  runQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function pickGeneral(result: MediaInfoResult): GeneralTrack | undefined {
  const tracks = result.media?.track
  if (!tracks) return undefined
  return tracks.find((t) => t['@type'] === 'General') as GeneralTrack | undefined
}

function pickVideo(result: MediaInfoResult): VideoTrack | undefined {
  const tracks = result.media?.track
  if (!tracks) return undefined
  return tracks.find((t) => t['@type'] === 'Video') as VideoTrack | undefined
}

function fmtMbpsFromBps(bps: number | undefined): string | null {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return null
  return `${(bps / 1_000_000).toFixed(2)} Mb/s`
}

function fmtFps(fr: number | undefined): number | null {
  if (fr == null || !Number.isFinite(fr) || fr <= 0 || fr > 1000) return null
  return fr
}

function buildCodec(v: VideoTrack): string | null {
  const fmt = (v.Format ?? '').trim()
  const prof = (v.Format_Profile ?? '').trim()
  const level = (v.Format_Level ?? '').trim()
  const parts = [fmt, prof, level].filter(Boolean)
  if (parts.length === 0 && v.CodecID_String) return String(v.CodecID_String)
  return parts.length ? parts.join(' ') : null
}

function frameRateModeCn(v: VideoTrack): string | null {
  const m = (v.FrameRate_Mode ?? v.FrameRate_Mode_String ?? '').toUpperCase()
  if (m.includes('CFR') || m === 'CONSTANT') return '固定帧率'
  if (m.includes('VFR') || m.includes('VARIABLE')) return '可变帧率'
  const mn = v.FrameRate_Minimum
  const mx = v.FrameRate_Maximum
  const nom = v.FrameRate
  if (
    mn != null &&
    mx != null &&
    nom != null &&
    Number.isFinite(mn) &&
    Number.isFinite(mx) &&
    Math.abs(mx - mn) > 0.02
  ) {
    return '可变帧率'
  }
  if (nom != null) return '固定帧率'
  return null
}

function durationSeconds(g: GeneralTrack): number | null {
  const d = g.Duration
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
    return d
  }
  return null
}

function mapMediaInfoResult(result: MediaInfoResult, fileSize: number): VideoWasmMetadata {
  const g = pickGeneral(result)
  const v = pickVideo(result)

  const durSec = g ? durationSeconds(g) : null
  const overallBr = g?.OverallBitRate
  let totalBitrateMbps = fmtMbpsFromBps(overallBr)
  if (!totalBitrateMbps && durSec != null && durSec > 1e-6 && fileSize > 0) {
    totalBitrateMbps = fmtMbpsFromBps((fileSize * 8) / durSec)
  }

  const fileSizeMb = fileSize > 0 ? `${(fileSize / (1024 * 1024)).toFixed(2)} MB` : null

  const frameRateHz = fmtFps(v?.FrameRate)
  const frameRateMode = v ? frameRateModeCn(v) : null

  const w = v?.Width
  const h = v?.Height
  let resolution: string | null = null
  if (w != null && h != null && w > 0 && h > 0) resolution = `${w}×${h}`

  const chroma = v?.ChromaSubsampling?.trim() || null
  const bd = v?.BitDepth
  const bitDepth =
    bd != null && Number.isFinite(bd) && bd > 0 ? `${Math.round(bd)} bit` : v?.BitDepth_String?.trim() || null

  const colorPrimaries = v?.colour_primaries?.trim() || v?.colour_primaries_Original?.trim() || null
  const transferCharacteristics =
    v?.transfer_characteristics?.trim() || v?.transfer_characteristics_Original?.trim() || null
  const matrixCoefficients = v?.matrix_coefficients?.trim() || v?.matrix_coefficients_Original?.trim() || null
  const colorRange = v?.colour_range?.trim() || null

  return {
    fileSizeMb,
    durationSec: durSec,
    totalBitrateMbps,
    codec: v ? buildCodec(v) : null,
    frameRateHz,
    frameRateMode,
    resolution,
    chromaSubsampling: chroma,
    bitDepth,
    colorPrimaries,
    transferCharacteristics,
    matrixCoefficients,
    colorRange,
    fpsSource: 'wasm',
  }
}

/**
 * Parse `blob` with MediaInfo WASM. Returns `null` on failure or unsupported input.
 */
export async function readVideoMetadataWasm(blob: Blob): Promise<VideoWasmMetadata | null> {
  if (!blob.size || blob.size > MAX_BYTES) return null
  return withAnalyzeLock(async () => {
    try {
      const mi = await getMediaInfo()
      const result = await mi.analyzeData(
        () => blob.size,
        (chunkSize, offset) => {
          const end = Math.min(blob.size, offset + chunkSize)
          return blob.slice(offset, end).arrayBuffer().then((ab) => new Uint8Array(ab))
        },
      )
      if (!result || typeof result !== 'object' || !('media' in result)) return null
      return mapMediaInfoResult(result as MediaInfoResult, blob.size)
    } catch {
      return null
    }
  })
}

/** Apply RVFC-derived fps onto a row (HUD 显示用). */
export function withRvfcFps(row: VideoWasmMetadata, fps: number): VideoWasmMetadata {
  return { ...row, frameRateHz: fps, fpsSource: 'rvfc' }
}
