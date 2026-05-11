import type { VideoSource } from '../types/video'

export const MANUAL_ALIGN_CACHE_STORAGE_KEY = 'widmax-manual-align-cache-v1'
const MAX_ENTRIES = 48

export interface ManualAlignCacheEntry {
  id: string
  createdAt: number
  /** 同一组文件（与勾选顺序无关） */
  groupCacheKey: string
  /** 基准文件签名：时长最长；并列则当前选中顺序中最靠左 */
  baselineSignature: string
  baselineLabel: string
  /** 相对基准播放时间的偏移（秒），含基准为 0 */
  offsetsBySignature: Record<string, number>
}

export function fileSignature(video: VideoSource): string {
  const size = video.blob != null ? video.blob.size : -1
  return `${video.name}\u001f${size}`
}

export function buildManualAlignGroupKey(videos: VideoSource[]): string | null {
  if (videos.length < 2) return null
  return videos
    .map((v) => fileSignature(v))
    .sort()
    .join('\u001e')
}

export function baselineIndexLongestTieLeft(
  videos: VideoSource[],
  progress: Record<string, { duration?: number }>,
): number {
  if (videos.length === 0) return 0
  let bestI = 0
  let bestD = progress[videos[0].id]?.duration ?? 0
  for (let i = 1; i < videos.length; i += 1) {
    const d = progress[videos[i].id]?.duration ?? 0
    if (d > bestD) {
      bestD = d
      bestI = i
    }
  }
  return bestI
}

export function isManualAlignEntryApplicable(
  entry: ManualAlignCacheEntry,
  videos: VideoSource[],
): boolean {
  if (videos.length < 2) return false
  const gk = buildManualAlignGroupKey(videos)
  if (!gk || entry.groupCacheKey !== gk) return false
  if (!videos.some((v) => fileSignature(v) === entry.baselineSignature)) return false
  for (const v of videos) {
    const sig = fileSignature(v)
    const off = entry.offsetsBySignature[sig]
    if (typeof off !== 'number' || !Number.isFinite(off)) return false
  }
  return true
}

export function findApplicableManualAlignEntry(
  entries: ManualAlignCacheEntry[],
  videos: VideoSource[],
): ManualAlignCacheEntry | undefined {
  const gk = buildManualAlignGroupKey(videos)
  if (!gk) return undefined
  const hit = entries.find((e) => e.groupCacheKey === gk)
  if (!hit) return undefined
  return isManualAlignEntryApplicable(hit, videos) ? hit : undefined
}

export function loadManualAlignCacheEntries(): ManualAlignCacheEntry[] {
  try {
    const raw = localStorage.getItem(MANUAL_ALIGN_CACHE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidManualEntry)
  } catch {
    return []
  }
}

function isValidManualEntry(x: unknown): x is ManualAlignCacheEntry {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.createdAt !== 'number' ||
    typeof o.groupCacheKey !== 'string' ||
    typeof o.baselineSignature !== 'string' ||
    typeof o.baselineLabel !== 'string' ||
    typeof o.offsetsBySignature !== 'object' ||
    o.offsetsBySignature === null
  ) {
    return false
  }
  const offs = o.offsetsBySignature as Record<string, unknown>
  for (const v of Object.values(offs)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false
  }
  return true
}

export function persistManualAlignCacheEntries(entries: ManualAlignCacheEntry[]): void {
  try {
    localStorage.setItem(MANUAL_ALIGN_CACHE_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* ignore */
  }
}

export function upsertManualAlignCacheEntry(
  entries: ManualAlignCacheEntry[],
  next: Omit<ManualAlignCacheEntry, 'id' | 'createdAt'>,
): ManualAlignCacheEntry[] {
  const entry: ManualAlignCacheEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...next,
  }
  const rest = entries.filter((e) => e.groupCacheKey !== entry.groupCacheKey)
  return [entry, ...rest].slice(0, MAX_ENTRIES)
}

export function removeManualAlignCacheEntry(entries: ManualAlignCacheEntry[], id: string) {
  return entries.filter((e) => e.id !== id)
}
