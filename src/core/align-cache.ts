import type { VideoSource } from '../types/video'

export const ALIGN_CACHE_STORAGE_KEY = 'widmax-align-cache-v1'
const MAX_ENTRIES = 48

export interface AlignCacheEntry {
  id: string
  createdAt: number
  cacheKey: string
  referenceLabel: string
  otherLabels: string[]
  /** Same order as `otherLabels`: target time = referenceTime + lagsSec[i] */
  lagsSec: number[]
}

export function buildAlignCacheKey(videos: VideoSource[]): string | null {
  if (videos.length < 2) return null
  return videos
    .map((v) => {
      const size = v.blob != null ? v.blob.size : -1
      return `${v.name}\u001f${size}`
    })
    .join('\u001e')
}

export function loadAlignCacheEntries(): AlignCacheEntry[] {
  try {
    const raw = localStorage.getItem(ALIGN_CACHE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidEntry)
  } catch {
    return []
  }
}

function isValidEntry(x: unknown): x is AlignCacheEntry {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.cacheKey === 'string' &&
    typeof o.referenceLabel === 'string' &&
    Array.isArray(o.otherLabels) &&
    o.otherLabels.every((l) => typeof l === 'string') &&
    Array.isArray(o.lagsSec) &&
    o.lagsSec.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    o.otherLabels.length === o.lagsSec.length
  )
}

export function persistAlignCacheEntries(entries: AlignCacheEntry[]): void {
  try {
    localStorage.setItem(ALIGN_CACHE_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* quota or private mode */
  }
}

export function findAlignCacheEntry(
  entries: AlignCacheEntry[],
  cacheKey: string,
): AlignCacheEntry | undefined {
  return entries.find((e) => e.cacheKey === cacheKey)
}

export function upsertAlignCacheEntry(
  entries: AlignCacheEntry[],
  next: Omit<AlignCacheEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): AlignCacheEntry[] {
  const entry: AlignCacheEntry = {
    id: next.id ?? crypto.randomUUID(),
    createdAt: next.createdAt ?? Date.now(),
    cacheKey: next.cacheKey,
    referenceLabel: next.referenceLabel,
    otherLabels: next.otherLabels,
    lagsSec: next.lagsSec,
  }
  const without = entries.filter((e) => e.cacheKey !== entry.cacheKey)
  const merged = [entry, ...without]
  return merged.slice(0, MAX_ENTRIES)
}

export function removeAlignCacheEntry(entries: AlignCacheEntry[], id: string): AlignCacheEntry[] {
  return entries.filter((e) => e.id !== id)
}
