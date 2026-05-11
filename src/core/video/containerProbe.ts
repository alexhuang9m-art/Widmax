import { createFile, type MP4BoxBuffer } from 'mp4box'

export interface VideoContainerProbe {
  fps: number | null
  codec: string | null
  colorSpace: string | null
}

const MAX_PROBE_BYTES = 450 * 1024 * 1024

function readU32BE(u8: Uint8Array, o: number): number {
  return ((u8[o]! << 24) | (u8[o + 1]! << 16) | (u8[o + 2]! << 8) | u8[o + 3]!) >>> 0
}

function fourcc(u8: Uint8Array, o: number): string {
  return String.fromCharCode(u8[o]!, u8[o + 1]!, u8[o + 2]!, u8[o + 3]!)
}

/** ITU-T H.273 / ISO 23001-8 colour_primaries */
function primariesLabel(p: number): string {
  switch (p) {
    case 1:
      return 'BT.709'
    case 4:
      return 'BT.470M'
    case 5:
      return 'BT.470BG'
    case 6:
    case 7:
      return 'SMPTE 170M'
    case 8:
      return 'Generic film'
    case 9:
      return 'BT.2020 / BT.2100'
    case 10:
    case 11:
      return 'SMPTE ST 428-1'
    default:
      return p > 0 ? `未知（primaries=${p}）` : '未知'
  }
}

function transferLabel(t: number): string {
  switch (t) {
    case 1:
    case 6:
      return 'BT.709 / BT.1361'
    case 4:
      return 'BT.470M'
    case 5:
      return 'BT.470BG'
    case 7:
      return 'SMPTE 170M'
    case 11:
      return 'IEC 61966-2-4 (sRGB)'
    case 13:
      return 'sYCC'
    case 14:
    case 15:
      return 'BT.2020 10/12-bit'
    case 16:
      return 'SMPTE ST 2084 (PQ)'
    case 18:
      return 'HLG (ARIB STD-B67)'
    default:
      return t > 0 ? `未知（transfer=${t}）` : '未知'
  }
}

function matrixLabel(m: number): string {
  switch (m) {
    case 1:
      return 'BT.709'
    case 4:
      return 'FCC US'
    case 5:
    case 6:
      return 'BT.470BG / BT.601'
    case 7:
      return 'SMPTE 170M'
    case 8:
      return 'YCgCo'
    case 9:
      return 'BT.2020 NCL'
    case 10:
      return 'BT.2020 CL'
    case 14:
      return 'ICTCP BT.2100'
    default:
      return m > 0 ? `未知（matrix=${m}）` : '未知'
  }
}

/** ISO/IEC 14496-12 VisualSampleEntry prefix before extension boxes (avc1/hvc1/vp09/…). */
const VISUAL_SAMPLE_ENTRY_PREFIX = 78

const VIDEO_SAMPLE_TYPES = new Set([
  'avc1',
  'avc3',
  'hvc1',
  'hev1',
  'dvh1',
  'dvhe',
  'dvav',
  'dav1',
  'vp08',
  'vp09',
  'av01',
  'mp4v',
  'apch',
  'apcn',
  'apcs',
  'apco',
  'ap4h',
  'ap4x',
  'encv',
  'hev2',
  'vvc1',
  'vvi1',
])

const CONTAINER_TYPES = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'elst',
  'tref',
  'udta',
  'meta',
  'dinf',
  'iprp',
  'ipco',
  'sinf',
  'schi',
  'wave',
  'gmhd',
])

function readBoxSize(u8: Uint8Array, o: number, parentEnd: number): { size: number; header: number } | null {
  if (o + 8 > parentEnd) return null
  let size = readU32BE(u8, o)
  let header = 8
  if (size === 1) {
    if (o + 16 > parentEnd) return null
    const hi = readU32BE(u8, o + 8)
    const lo = readU32BE(u8, o + 12)
    size = hi * 0x1_0000_0000 + lo
    header = 16
  }
  if (size === 0) size = parentEnd - o
  if (size < header || o + size > parentEnd) return null
  return { size, header }
}

function fourccFromPayload(payload: Uint8Array, off: number): string {
  if (off + 4 > payload.length) return ''
  return String.fromCharCode(
    payload[off]!,
    payload[off + 1]!,
    payload[off + 2]!,
    payload[off + 3]!,
  )
}

/** nclx layout after the 4-char colour_type (primaries, transfer, matrix, range u16). */
function parseNclxAfterType(payload: Uint8Array, typeOffset: number): string | null {
  const data0 = typeOffset + 4
  if (payload.length < data0 + 8) return null
  const prim = (payload[data0]! << 8) | payload[data0 + 1]!
  const transfer = (payload[data0 + 2]! << 8) | payload[data0 + 3]!
  const matrix = (payload[data0 + 4]! << 8) | payload[data0 + 5]!
  const fr = (payload[data0 + 6]! << 8) | payload[data0 + 7]!
  const full = (fr & 0x8000) !== 0
  return [
    `色域基色 ${primariesLabel(prim)}`,
    `传递特性 ${transferLabel(transfer)}`,
    `矩阵系数 ${matrixLabel(matrix)}`,
    full ? '全范围' : '有限范围',
  ].join(' · ')
}

/** Parse ColourInformationBox at `o` (box start), size includes header. */
function parseColrBox(u8: Uint8Array, o: number, boxSize: number): string | null {
  if (boxSize < 18 || o + boxSize > u8.length) return null
  if (fourcc(u8, o + 4) !== 'colr') return null
  const payload = u8.subarray(o + 8, o + boxSize)
  if (payload.length < 8) return null

  /** ISO: FullBox（version+flags）后接 colour_type；部分 QuickTime 为紧跟 colour_type。 */
  const typeAt4 = fourccFromPayload(payload, 4)
  if (typeAt4 === 'nclx') {
    const r = parseNclxAfterType(payload, 4)
    if (r) return r
  }
  const typeAt0 = fourccFromPayload(payload, 0)
  if (typeAt0 === 'nclx') {
    const r = parseNclxAfterType(payload, 0)
    if (r) return r
  }

  const colourType = typeAt4 === 'nclx' || typeAt4 === 'prof' || typeAt4 === 'rICC' ? typeAt4 : typeAt0
  if (colourType === 'prof' || colourType === 'rICC') {
    const skip = typeAt4 === colourType ? 8 : 4
    return `ICC 色彩配置（${colourType}，${Math.max(0, payload.length - skip)} 字节）`
  }
  if (colourType && colourType !== 'nclx') return `colr 类型 ${colourType}`
  return null
}

/**
 * Walk ISO BMFF boxes (skip mdat) to find `colr` inside moov / stsd / sample entries.
 * Linear scan fails because colr is nested, not at top level.
 */
export function probeNclxColorSpace(buffer: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buffer)
  const fileEnd = u8.length

  const tryColr = (boxStart: number, boxSize: number): string | null => {
    if (fourcc(u8, boxStart + 4) === 'colr') return parseColrBox(u8, boxStart, boxSize)
    return null
  }

  const walk = (regionStart: number, regionEnd: number): string | null => {
    let o = regionStart
    while (o + 8 <= regionEnd) {
      const bs = readBoxSize(u8, o, regionEnd)
      if (!bs) break
      const { size, header } = bs
      const typ = fourcc(u8, o + 4)
      const boxEnd = o + size

      const direct = tryColr(o, size)
      if (direct) return direct

      if (typ === 'mdat' || typ === 'free' || typ === 'skip' || typ === 'wide') {
        o = boxEnd
        continue
      }

      const dataStart = o + header
      if (dataStart >= boxEnd) {
        o = boxEnd
        continue
      }

      if (typ === 'stsd') {
        if (dataStart + 8 > boxEnd) {
          o = boxEnd
          continue
        }
        const entryCount = readU32BE(u8, dataStart + 4)
        let p = dataStart + 8
        for (let e = 0; e < entryCount && p + 8 <= boxEnd; e += 1) {
          const eb = readBoxSize(u8, p, boxEnd)
          if (!eb) break
          const et = fourcc(u8, p + 4)
          const entryEnd = p + eb.size
          if (entryEnd > boxEnd) break

          const innerColr = tryColr(p, eb.size)
          if (innerColr) return innerColr

          if (VIDEO_SAMPLE_TYPES.has(et)) {
            for (const prefix of [VISUAL_SAMPLE_ENTRY_PREFIX, 86, 70, 90]) {
              const extStart = p + 8 + prefix
              if (extStart >= entryEnd) continue
              const r = walk(extStart, entryEnd)
              if (r) return r
            }
          } else {
            const r = walk(p + eb.header, entryEnd)
            if (r) return r
          }
          p = entryEnd
        }
        o = boxEnd
        continue
      }

      if (CONTAINER_TYPES.has(typ) || typ === 'moof' || typ === 'traf' || typ === 'mfra') {
        const r = walk(dataStart, boxEnd)
        if (r) return r
      } else if (VIDEO_SAMPLE_TYPES.has(typ)) {
        for (const prefix of [VISUAL_SAMPLE_ENTRY_PREFIX, 86, 70, 90]) {
          const extStart = o + 8 + prefix
          if (extStart >= boxEnd) continue
          const r = walk(extStart, boxEnd)
          if (r) return r
        }
      }

      o = boxEnd
    }
    return null
  }

  return walk(0, fileEnd)
}

function snapCommonFps(f: number): number {
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

export async function probeVideoContainer(blob: Blob): Promise<VideoContainerProbe | null> {
  if (blob.size === 0) return null
  if (blob.size > MAX_PROBE_BYTES) return null

  let buffer: ArrayBuffer
  try {
    buffer = await blob.arrayBuffer()
  } catch {
    return null
  }

  const colorSpace = probeNclxColorSpace(buffer)

  return new Promise((resolve) => {
    const mp4file = createFile()
    let settled = false
    let timeoutId = 0
    const done = (r: VideoContainerProbe | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      resolve(r)
    }

    timeoutId = window.setTimeout(() => {
      done(colorSpace ? { fps: null, codec: null, colorSpace } : null)
    }, 4000)

    mp4file.onError = () => {
      done(colorSpace ? { fps: null, codec: null, colorSpace } : null)
    }

    mp4file.onReady = (info: {
      tracks: Array<{
        video?: { width: number; height: number }
        timescale: number
        duration: number
        nb_samples?: number
        codec?: string
      }>
    }) => {
      const vt = info.tracks.find((t) => t.video)
      if (!vt || vt.timescale <= 0 || vt.duration <= 0) {
        done({ fps: null, codec: vt?.codec ?? null, colorSpace })
        return
      }
      const sec = vt.duration / vt.timescale
      let fps: number | null = null
      if (vt.nb_samples != null && vt.nb_samples > 0 && sec > 1e-6) {
        fps = snapCommonFps(vt.nb_samples / sec)
      }
      const codec = vt.codec ? `video/mp4; codecs="${vt.codec}"` : null
      done({ fps, codec, colorSpace })
    }

    try {
      const ab = buffer as MP4BoxBuffer
      ab.fileStart = 0
      mp4file.appendBuffer(ab)
      mp4file.flush()
    } catch {
      done(colorSpace ? { fps: null, codec: null, colorSpace } : null)
    }
  })
}

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
