/**
 * Tier-2 colour metadata: parse MP4 `avcC` / `hvcC` and read H.264 SPS/VUI or HEVC SPS
 * common VUI (same layout as ff_h2645_decode_common_vui_params).
 */

import { formatIso23001ColorDescription } from './colorLabels'

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

function readU32BE(u8: Uint8Array, o: number): number {
  return ((u8[o]! << 24) | (u8[o + 1]! << 16) | (u8[o + 2]! << 8) | u8[o + 3]!) >>> 0
}

function fourcc(u8: Uint8Array, o: number): string {
  return String.fromCharCode(u8[o]!, u8[o + 1]!, u8[o + 2]!, u8[o + 3]!)
}

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

/** Walk ISO BMFF (skip mdat) and collect first `avcC` / `hvcC` payloads. */
function findDecoderConfigBoxes(buffer: ArrayBuffer): { avcC: Uint8Array | null; hvcC: Uint8Array | null } {
  const u8 = new Uint8Array(buffer)
  let avcC: Uint8Array | null = null
  let hvcC: Uint8Array | null = null

  const walk = (regionStart: number, regionEnd: number): void => {
    let o = regionStart
    while (o + 8 <= regionEnd) {
      const bs = readBoxSize(u8, o, regionEnd)
      if (!bs) break
      const { size, header } = bs
      const typ = fourcc(u8, o + 4)
      const boxEnd = o + size

      if (typ === 'avcC' && !avcC && o + 8 <= boxEnd) {
        avcC = u8.subarray(o + 8, boxEnd)
      } else if ((typ === 'hvcC' || typ === 'hevC') && !hvcC && o + 8 <= boxEnd) {
        hvcC = u8.subarray(o + 8, boxEnd)
      }

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

          if (VIDEO_SAMPLE_TYPES.has(et)) {
            for (const prefix of [VISUAL_SAMPLE_ENTRY_PREFIX, 86, 70, 90]) {
              const extStart = p + 8 + prefix
              if (extStart < entryEnd) walk(extStart, entryEnd)
            }
          } else {
            walk(p + eb.header, entryEnd)
          }
          p = entryEnd
        }
        o = boxEnd
        continue
      }

      if (CONTAINER_TYPES.has(typ) || typ === 'moof' || typ === 'traf' || typ === 'mfra') {
        walk(dataStart, boxEnd)
      } else if (VIDEO_SAMPLE_TYPES.has(typ)) {
        for (const prefix of [VISUAL_SAMPLE_ENTRY_PREFIX, 86, 70, 90]) {
          const extStart = o + 8 + prefix
          if (extStart < boxEnd) walk(extStart, boxEnd)
        }
      }

      o = boxEnd
    }
  }

  walk(0, u8.length)
  return { avcC, hvcC }
}

function stripEmulationPrevention3b(src: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < src.length) {
    if (i + 2 < src.length && src[i] === 0 && src[i + 1] === 0 && src[i + 2] === 3) {
      out.push(0, 0)
      i += 3
      continue
    }
    out.push(src[i]!)
    i += 1
  }
  return new Uint8Array(out)
}

/** MSB-first bit reader over RBSP bytes. */
class Br {
  private readonly u8: Uint8Array
  private idx = 0
  private cur = 0
  private left = 0

  constructor(u8: Uint8Array) {
    this.u8 = u8
  }

  bitsLeft(): number {
    return this.left + (this.u8.length - this.idx) * 8
  }

  read1(): number | null {
    if (this.left === 0) {
      if (this.idx >= this.u8.length) return null
      this.cur = this.u8[this.idx]!
      this.idx += 1
      this.left = 8
    }
    this.left -= 1
    return (this.cur >> this.left) & 1
  }

  readBits(n: number): number | null {
    if (n === 0) return 0
    let v = 0
    for (let k = 0; k < n; k += 1) {
      const b = this.read1()
      if (b === null) return null
      v = (v << 1) | b
    }
    return v
  }

  readUE(): number | null {
    let z = 0
    for (;;) {
      const b = this.read1()
      if (b === null) return null
      if (b === 0) z += 1
      else break
    }
    if (z > 31) return null
    const rest = this.readBits(z)
    if (rest === null) return null
    return (1 << z) - 1 + rest
  }

  readSE(): number | null {
    const ue = this.readUE()
    if (ue === null) return null
    const k = (ue + 1) >>> 1
    return (ue & 1) !== 0 ? k : -k
  }
}

const ZIGZAG16 = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]

const ZIGZAG64 = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14,
  21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60,
  61, 54, 47, 55, 62, 63,
]

const DEFAULT_SCALING4: [number[], number[]] = [
  [6, 13, 20, 28, 13, 20, 28, 32, 20, 28, 32, 37, 28, 32, 37, 42],
  [10, 14, 20, 24, 14, 20, 24, 27, 20, 24, 27, 30, 24, 27, 30, 34],
]

const DEFAULT_SCALING8: [number[], number[]] = [
  [
    6, 10, 13, 16, 18, 23, 25, 27, 10, 11, 16, 18, 23, 25, 27, 29, 13, 16, 18, 23, 25, 27, 29, 31, 16, 18, 23, 25,
    27, 29, 31, 33, 18, 23, 25, 27, 29, 31, 33, 36, 23, 25, 27, 29, 31, 33, 36, 38, 25, 27, 29, 31, 33, 36, 38, 40,
    27, 29, 31, 33, 36, 38, 40, 42,
  ],
  [
    9, 13, 15, 17, 19, 21, 22, 24, 13, 13, 17, 19, 21, 22, 24, 25, 15, 17, 19, 21, 22, 24, 25, 27, 17, 19, 21, 22,
    24, 25, 27, 28, 19, 21, 22, 24, 25, 27, 28, 30, 21, 22, 24, 25, 27, 28, 30, 32, 22, 24, 25, 27, 28, 30, 32, 33,
    24, 25, 27, 28, 30, 32, 33, 35,
  ],
]

function h264DecodeScalingList(
  br: Br,
  factors: Uint8Array,
  size: number,
  jvt: Uint8Array,
  fallback: Uint8Array,
  scan: readonly number[],
): boolean {
  const present = br.read1()
  if (present === null) return false
  if (!present) {
    factors.set(fallback)
    return true
  }
  let last = 8
  let next = 8
  for (let i = 0; i < size; i += 1) {
    if (next) {
      const v = br.readSE()
      if (v === null || v < -128 || v > 127) return false
      next = (last + v) & 0xff
    }
    if (i === 0 && next === 0) {
      factors.set(jvt)
      break
    }
    const pos = scan[i]!
    last = factors[pos] = next !== 0 ? next : last
  }
  return true
}

function h264DecodeScalingMatrices(
  br: Br,
  chromaFormatIdc: number,
  seqScalingMatrixPresent: boolean,
  scaling4: Uint8Array[],
  scaling8: Uint8Array[],
): boolean {
  const fallbackSps = false
  const fallback: Uint8Array[] = [
    fallbackSps ? scaling4[0]! : new Uint8Array(DEFAULT_SCALING4[0]!),
    fallbackSps ? scaling4[3]! : new Uint8Array(DEFAULT_SCALING4[1]!),
    fallbackSps ? scaling8[0]! : new Uint8Array(DEFAULT_SCALING8[0]!),
    fallbackSps ? scaling8[3]! : new Uint8Array(DEFAULT_SCALING8[1]!),
  ]
  if (!seqScalingMatrixPresent) return true
  const scan16 = ZIGZAG16
  const scan64 = ZIGZAG64
  if (!h264DecodeScalingList(br, scaling4[0]!, 16, new Uint8Array(DEFAULT_SCALING4[0]!), fallback[0]!, scan16))
    return false
  if (!h264DecodeScalingList(br, scaling4[1]!, 16, new Uint8Array(DEFAULT_SCALING4[0]!), scaling4[0]!, scan16))
    return false
  if (!h264DecodeScalingList(br, scaling4[2]!, 16, new Uint8Array(DEFAULT_SCALING4[0]!), scaling4[1]!, scan16))
    return false
  if (!h264DecodeScalingList(br, scaling4[3]!, 16, new Uint8Array(DEFAULT_SCALING4[1]!), fallback[1]!, scan16))
    return false
  if (!h264DecodeScalingList(br, scaling4[4]!, 16, new Uint8Array(DEFAULT_SCALING4[1]!), scaling4[3]!, scan16))
    return false
  if (!h264DecodeScalingList(br, scaling4[5]!, 16, new Uint8Array(DEFAULT_SCALING4[1]!), scaling4[4]!, scan16))
    return false
  if (!h264DecodeScalingList(br, scaling8[0]!, 64, new Uint8Array(DEFAULT_SCALING8[0]!), fallback[2]!, scan64))
    return false
  if (!h264DecodeScalingList(br, scaling8[3]!, 64, new Uint8Array(DEFAULT_SCALING8[1]!), fallback[3]!, scan64))
    return false
  if (chromaFormatIdc === 3) {
    if (!h264DecodeScalingList(br, scaling8[1]!, 64, new Uint8Array(DEFAULT_SCALING8[0]!), scaling8[0]!, scan64))
      return false
    if (!h264DecodeScalingList(br, scaling8[4]!, 64, new Uint8Array(DEFAULT_SCALING8[1]!), scaling8[3]!, scan64))
      return false
    if (!h264DecodeScalingList(br, scaling8[2]!, 64, new Uint8Array(DEFAULT_SCALING8[0]!), scaling8[1]!, scan64))
      return false
    if (!h264DecodeScalingList(br, scaling8[5]!, 64, new Uint8Array(DEFAULT_SCALING8[1]!), scaling8[4]!, scan64))
      return false
  }
  return true
}

function decodeHrdParameters(br: Br): boolean {
  const cpbCnt = br.readUE()
  if (cpbCnt === null || cpbCnt + 1 > 32) return false
  if (br.readBits(4) === null) return false
  if (br.readBits(4) === null) return false
  for (let i = 0; i < cpbCnt + 1; i += 1) {
    if (br.readUE() === null || br.readUE() === null || br.read1() === null) return false
  }
  if (br.readBits(5) === null || br.readBits(5) === null || br.readBits(5) === null || br.readBits(5) === null)
    return false
  return true
}

/** H.264/HEVC common VUI (colour) — same field order as FFmpeg `ff_h2645_decode_common_vui_params`. */
function readCommonVuiColour(br: Br): {
  primaries: number
  transfer: number
  matrix: number
  fullRange: boolean | null
  colourPresent: boolean
  videoSignalPresent: boolean
} | null {
  const aspectInfo = br.read1()
  if (aspectInfo === null) return null
  if (aspectInfo) {
    const idc = br.readBits(8)
    if (idc === null) return null
    if (idc === 255) {
      if (br.readBits(16) === null || br.readBits(16) === null) return null
    }
  }
  const overscanInfo = br.read1()
  if (overscanInfo === null) return null
  if (overscanInfo && br.read1() === null) return null

  const videoSignalTypePresent = br.read1()
  if (videoSignalTypePresent === null) return null
  let fullRange: boolean | null = null
  let colourPresent = false
  let primaries = 2
  let transfer = 2
  let matrix = 2
  if (videoSignalTypePresent) {
    if (br.readBits(3) === null) return null
    const fr = br.read1()
    if (fr === null) return null
    fullRange = fr !== 0
    const colourDesc = br.read1()
    if (colourDesc === null) return null
    colourPresent = colourDesc !== 0
    if (colourDesc) {
      const p = br.readBits(8)
      const t = br.readBits(8)
      const m = br.readBits(8)
      if (p === null || t === null || m === null) return null
      primaries = p
      transfer = t
      matrix = m
    }
  }
  const chromaLocPresent = br.read1()
  if (chromaLocPresent === null) return null
  if (chromaLocPresent) {
    if (br.readUE() === null || br.readUE() === null) return null
  }
  return { primaries, transfer, matrix, fullRange, colourPresent, videoSignalPresent: !!videoSignalTypePresent }
}

function formatBitstreamColour(
  codec: 'H.264' | 'HEVC',
  primaries: number,
  transfer: number,
  matrix: number,
  fullRange: boolean | null,
): string {
  const body = formatIso23001ColorDescription(primaries, transfer, matrix, fullRange)
  return `比特流（${codec} SPS/VUI）${body}`
}

function decodeH264VuiRest(br: Br): boolean {
  const timing = br.read1()
  if (timing === null) return false
  if (timing) {
    if (br.readBits(32) === null || br.readBits(32) === null || br.read1() === null) return false
  }
  const nalHrd = br.read1()
  if (nalHrd === null) return false
  if (nalHrd && !decodeHrdParameters(br)) return false
  const vclHrd = br.read1()
  if (vclHrd === null) return false
  if (vclHrd && !decodeHrdParameters(br)) return false
  if ((nalHrd !== 0 || vclHrd !== 0) && br.read1() === null) return false
  if (br.read1() === null) return false
  const bitstreamRestriction = br.read1()
  if (bitstreamRestriction === null) return false
  if (bitstreamRestriction) {
    if (
      br.read1() === null ||
      br.readUE() === null ||
      br.readUE() === null ||
      br.readUE() === null ||
      br.readUE() === null ||
      br.readUE() === null ||
      br.readUE() === null
    )
      return false
  }
  return true
}

function parseH264SpsRbsp(rbsp: Uint8Array): string | null {
  const br = new Br(rbsp)
  const profileIdc = br.readBits(8)
  if (profileIdc === null) return null
  if (br.readBits(8) === null) return null
  if (br.readBits(8) === null) return null
  const spsId = br.readUE()
  if (spsId === null || spsId > 31) return null

  const highProfiles = new Set([
    100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 144,
  ])
  const scaling4 = Array.from({ length: 6 }, () => new Uint8Array(16))
  const scaling8 = Array.from({ length: 6 }, () => new Uint8Array(64))
  for (const m of scaling4) m.fill(16)
  for (const m of scaling8) m.fill(16)

  if (highProfiles.has(profileIdc)) {
    const c = br.readUE()
    if (c === null || c > 3) return null
    const chromaFormatIdc = c
    if (chromaFormatIdc === 3) {
      if (br.read1() === null) return null
    }
    if (br.readUE() === null || br.readUE() === null) return null
    if (br.read1() === null) return null
    const seqScalingMatrixPresent = br.read1()
    if (seqScalingMatrixPresent === null) return null
    if (!h264DecodeScalingMatrices(br, chromaFormatIdc, !!seqScalingMatrixPresent, scaling4, scaling8)) return null
  }

  if (br.readUE() === null) return null
  const pocType = br.readUE()
  if (pocType === null) return null
  if (pocType === 0) {
    if (br.readUE() === null) return null
  } else if (pocType === 1) {
    if (br.read1() === null || br.readSE() === null || br.readSE() === null) return null
    const cycle = br.readUE()
    if (cycle === null || cycle > 255) return null
    for (let i = 0; i < cycle; i += 1) {
      if (br.readSE() === null) return null
    }
  } else if (pocType !== 2) return null

  if (br.readUE() === null || br.read1() === null) return null
  if (br.readUE() === null || br.readUE() === null) return null
  const frameMbsOnly = br.read1()
  if (frameMbsOnly === null) return null
  if (!frameMbsOnly) {
    if (br.read1() === null) return null
  }
  if (br.read1() === null) return null
  const crop = br.read1()
  if (crop === null) return null
  if (crop) {
    if (br.readUE() === null || br.readUE() === null || br.readUE() === null || br.readUE() === null) return null
  }
  const vuiPresent = br.read1()
  if (vuiPresent === null || !vuiPresent) return null

  const colour = readCommonVuiColour(br)
  if (!colour) return null
  if (!decodeH264VuiRest(br)) return null

  if (colour.colourPresent) {
    return formatBitstreamColour('H.264', colour.primaries, colour.transfer, colour.matrix, colour.fullRange)
  }
  if (colour.videoSignalPresent && colour.fullRange != null) {
    return `比特流（H.264 SPS/VUI）无 colour_description · ${colour.fullRange ? '全范围' : '有限范围'}`
  }
  return null
}

function firstSpsFromAvcC(avcC: Uint8Array): Uint8Array | null {
  if (avcC.length < 7) return null
  const numSps = avcC[5]! & 0x1f
  if (numSps === 0) return null
  let o = 6
  for (let i = 0; i < numSps; i += 1) {
    if (o + 2 > avcC.length) return null
    const len = (avcC[o]! << 8) | avcC[o + 1]!
    o += 2
    if (o + len > avcC.length || len < 1) return null
    const nal = avcC.subarray(o, o + len)
    o += len
    const nalType = nal[0]! & 0x1f
    if (nalType === 7) return stripEmulationPrevention3b(nal.subarray(1))
  }
  return null
}

/** GPAC-compatible `hvcC` / ISO 14496-15 HEVCDecoderConfigurationRecord (non-LHVC). */
function iterHevcDecoderNals(hvcC: Uint8Array): Array<{ type: number; data: Uint8Array }> | null {
  if (hvcC.length < 23) return null
  const br = new Br(hvcC)
  if (br.readBits(8) === null) return null
  if (br.readBits(2) === null || br.readBits(1) === null || br.readBits(5) === null) return null
  if (br.readBits(32) === null) return null
  if (br.readBits(4) === null || br.readBits(44) === null) return null
  if (br.readBits(8) === null) return null
  if (br.readBits(4) === null || br.readBits(12) === null) return null
  if (br.readBits(6) === null || br.readBits(2) === null) return null
  if (br.readBits(6) === null || br.readBits(2) === null) return null
  if (br.readBits(5) === null || br.readBits(3) === null) return null
  if (br.readBits(5) === null || br.readBits(3) === null) return null
  if (br.readBits(16) === null) return null
  if (br.readBits(2) === null) return null
  if (br.readBits(3) === null || br.readBits(1) === null || br.readBits(2) === null) return null
  const numArrays = br.readBits(8)
  if (numArrays === null) return null
  const out: Array<{ type: number; data: Uint8Array }> = []
  for (let a = 0; a < numArrays; a += 1) {
    if (br.readBits(1) === null || br.readBits(1) === null) return null
    const nalType = br.readBits(6)
    if (nalType === null) return null
    const nNalus = br.readBits(16)
    if (nNalus === null) return null
    for (let n = 0; n < nNalus; n += 1) {
      const sz = br.readBits(16)
      if (sz === null || sz <= 0) return null
      if (br.bitsLeft() < sz * 8) return null
      const raw = new Uint8Array(sz)
      for (let b = 0; b < sz; b += 1) {
        const v = br.readBits(8)
        if (v === null) return null
        raw[b] = v
      }
      out.push({ type: nalType, data: raw })
    }
  }
  return out
}

function firstSpsNalFromHvcC(hvcC: Uint8Array): Uint8Array | null {
  const nals = iterHevcDecoderNals(hvcC)
  if (!nals) return null
  for (const { type, data } of nals) {
    if (type === 33 && data.length >= 3) return data
  }
  return null
}

type HevcPtlScratch = {
  profileIdc: number
  profileCompat: boolean[]
}

function hevcDecodeProfileTierLevel(br: Br, ptl: HevcPtlScratch): boolean {
  if (br.bitsLeft() < 2 + 1 + 5 + 32 + 4 + 43 + 1) return false
  ptl.profileCompat = new Array(32).fill(false)
  if (br.readBits(2) === null || br.read1() === null) return false
  const pidc = br.readBits(5)
  if (pidc === null) return false
  ptl.profileIdc = pidc
  for (let i = 0; i < 32; i += 1) {
    const b = br.read1()
    if (b === null) return false
    ptl.profileCompat[i] = b !== 0
    if (ptl.profileIdc === 0 && i > 0 && ptl.profileCompat[i]) ptl.profileIdc = i
  }
  if (br.read1() === null || br.read1() === null || br.read1() === null || br.read1() === null) return false
  const check = (idc: number) => ptl.profileIdc === idc || ptl.profileCompat[idc]!
  if (
    check(4) ||
    check(5) ||
    check(6) ||
    check(7) ||
    check(8) ||
    check(9) ||
    check(10)
  ) {
    for (let k = 0; k < 10; k += 1) if (br.read1() === null) return false
    if (check(5) || check(9) || check(10)) {
      if (br.read1() === null || br.readBits(33) === null) return false
    } else {
      if (br.readBits(34) === null) return false
    }
  } else if (check(2)) {
    if (br.readBits(7) === null || br.read1() === null || br.readBits(35) === null) return false
  } else {
    if (br.readBits(43) === null) return false
  }
  if (check(1) || check(2) || check(3) || check(4) || check(5) || check(9)) {
    if (br.read1() === null) return false
  } else {
    if (br.read1() === null) return false
  }
  return true
}

function hevcParsePtl(br: Br, maxSubLayers: number): boolean {
  const g: HevcPtlScratch = { profileIdc: 0, profileCompat: [] }
  if (!hevcDecodeProfileTierLevel(br, g)) return false
  if (br.bitsLeft() < 8 + (maxSubLayers - 1 > 0 ? 16 : 0)) return false
  if (br.readBits(8) === null) return false
  const subProf: boolean[] = []
  const subLev: boolean[] = []
  for (let i = 0; i < maxSubLayers - 1; i += 1) {
    const p = br.read1()
    const l = br.read1()
    if (p === null || l === null) return false
    subProf.push(p !== 0)
    subLev.push(l !== 0)
  }
  if (maxSubLayers - 1 > 0) {
    for (let i = maxSubLayers - 1; i < 8; i += 1) {
      if (br.readBits(2) === null) return false
    }
  }
  for (let i = 0; i < maxSubLayers - 1; i += 1) {
    if (subProf[i]) {
      const sub: HevcPtlScratch = { profileIdc: 0, profileCompat: [] }
      if (!hevcDecodeProfileTierLevel(br, sub)) return false
    }
    if (subLev[i]) {
      if (br.readBits(8) === null) return false
    }
  }
  return true
}

function hevcDecodeShortTermRps(br: Br, nbStRps: number, stIdx: number): boolean {
  let rpsPredict: number | null = 0
  if (stIdx > 0 && nbStRps > 0) {
    rpsPredict = br.read1()
    if (rpsPredict === null) return false
  }
  if (rpsPredict !== 0) {
    return false
  }
  const numNeg = br.readUE()
  const numPos = br.readUE()
  if (numNeg === null || numPos === null) return false
  if (numNeg >= 64 || numPos >= 64) return false
  for (let i = 0; i < numNeg; i += 1) {
    if (br.readUE() === null || br.read1() === null) return false
  }
  for (let i = 0; i < numPos; i += 1) {
    if (br.readUE() === null || br.read1() === null) return false
  }
  return true
}

function parseHevcSpsRbsp(rbsp: Uint8Array): string | null {
  const br = new Br(rbsp)
  if (br.readBits(4) === null) return null
  const m3 = br.readBits(3)
  if (m3 === null) return null
  const maxSubLayers = m3 + 1
  if (maxSubLayers <= 0 || maxSubLayers > 8) return null
  if (br.read1() === null) return null
  if (!hevcParsePtl(br, maxSubLayers)) return null
  const spsId = br.readUE()
  if (spsId === null || spsId >= 16) return null
  const chromaFormatIdc = br.readUE()
  if (chromaFormatIdc === null || chromaFormatIdc > 3) return null
  if (chromaFormatIdc === 3 && br.read1() === null) return null
  if (br.readUE() === null || br.readUE() === null) return null
  const confWin = br.read1()
  if (confWin === null) return null
  if (confWin !== 0) {
    if (br.readUE() === null || br.readUE() === null || br.readUE() === null || br.readUE() === null) return null
  }
  if (br.readUE() === null || br.readUE() === null) return null
  const log2MaxPocLsb = (br.readUE() ?? -1) + 4
  if (log2MaxPocLsb < 4 || log2MaxPocLsb > 16) return null
  const sublayerOrdering = br.read1()
  if (sublayerOrdering === null) return null
  const start = sublayerOrdering !== 0 ? 0 : maxSubLayers - 1
  for (let i = start; i < maxSubLayers; i += 1) {
    if (br.readUE() === null || br.readUE() === null || br.readUE() === null) return null
  }
  if (br.readUE() === null || br.readUE() === null || br.readUE() === null || br.readUE() === null) return null
  if (br.readUE() === null || br.readUE() === null) return null
  const scalingList = br.read1()
  if (scalingList === null) return null
  if (scalingList !== 0) {
    const hasCustomScaling = br.read1()
    if (hasCustomScaling === null) return null
    if (hasCustomScaling !== 0) return null
  }
  if (br.read1() === null || br.read1() === null) return null
  const pcm = br.read1()
  if (pcm === null) return null
  if (pcm !== 0) {
    if (br.readBits(4) === null || br.readBits(4) === null) return null
    if (br.readUE() === null || br.readUE() === null) return null
    if (br.read1() === null) return null
  }
  const nbStRps = br.readUE()
  if (nbStRps === null || nbStRps > 64) return null
  for (let i = 0; i < nbStRps; i += 1) {
    if (!hevcDecodeShortTermRps(br, nbStRps, i)) return null
  }
  const longTerm = br.read1()
  if (longTerm === null) return null
  if (longTerm !== 0) {
    const n = br.readUE()
    if (n === null || n > 32) return null
    for (let i = 0; i < n; i += 1) {
      if (br.readBits(log2MaxPocLsb) === null || br.read1() === null) return null
    }
  }
  if (br.read1() === null || br.read1() === null) return null
  const vuiPresent = br.read1()
  if (vuiPresent === null || vuiPresent === 0) return null
  const colour = readCommonVuiColour(br)
  if (!colour) return null
  if (colour.colourPresent) {
    return formatBitstreamColour('HEVC', colour.primaries, colour.transfer, colour.matrix, colour.fullRange)
  }
  if (colour.videoSignalPresent && colour.fullRange != null) {
    return `比特流（HEVC SPS/VUI）无 colour_description · ${colour.fullRange ? '全范围' : '有限范围'}`
  }
  return null
}

export function probeBitstreamColorSpace(buffer: ArrayBuffer): string | null {
  const { avcC, hvcC } = findDecoderConfigBoxes(buffer)
  if (avcC) {
    const sps = firstSpsFromAvcC(avcC)
    if (sps && sps.length >= 3) {
      const r = parseH264SpsRbsp(sps)
      if (r) return r
    }
  }
  if (hvcC) {
    const nal = firstSpsNalFromHvcC(hvcC)
    if (nal && nal.length > 2) {
      const rbsp = stripEmulationPrevention3b(nal.subarray(2))
      const r = parseHevcSpsRbsp(rbsp)
      if (r) return r
    }
  }
  return null
}
