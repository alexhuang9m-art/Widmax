import { create } from 'zustand'
import type {
  AnnotationMark,
  LayoutMode,
  PerformanceProfile,
  RoiRect,
  SlotId,
  VideoSource,
} from '../types/video'

interface SlotState {
  source: VideoSource | null
  locked: boolean
  roi: RoiRect | null
}

interface PerfStats {
  fps: number
  droppedFrames: number
  decodeLatencyMs: number
}

interface LabState {
  layout: LayoutMode
  isPlaying: boolean
  playbackRate: number
  masterTime: number
  profile: PerformanceProfile
  slots: Record<SlotId, SlotState>
  marks: AnnotationMark[]
  stats: Record<SlotId, PerfStats>
  setLayout: (layout: LayoutMode) => void
  setProfile: (profile: PerformanceProfile) => void
  togglePlayback: () => void
  setPlaybackRate: (rate: number) => void
  setMasterTime: (time: number) => void
  setSource: (slot: SlotId, source: VideoSource | null) => void
  toggleLock: (slot: SlotId) => void
  setRoi: (slot: SlotId, roi: RoiRect | null) => void
  addMark: (at: number, note: string) => void
  updateStats: (slot: SlotId, stats: Partial<PerfStats>) => void
}

const defaultSlot = (): SlotState => ({ source: null, locked: true, roi: null })
const defaultStats = (): PerfStats => ({ fps: 0, droppedFrames: 0, decodeLatencyMs: 0 })

const id = () => crypto.randomUUID()

export const useLabStore = create<LabState>((set) => ({
  layout: 'quad',
  isPlaying: false,
  playbackRate: 1,
  masterTime: 0,
  profile: 'balanced',
  slots: {
    0: defaultSlot(),
    1: defaultSlot(),
    2: defaultSlot(),
    3: defaultSlot(),
  },
  marks: [],
  stats: {
    0: defaultStats(),
    1: defaultStats(),
    2: defaultStats(),
    3: defaultStats(),
  },
  setLayout: (layout) => set({ layout }),
  setProfile: (profile) => set({ profile }),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setMasterTime: (masterTime) => set({ masterTime }),
  setSource: (slot, source) =>
    set((state) => ({
      slots: {
        ...state.slots,
        [slot]: {
          ...state.slots[slot],
          source,
        },
      },
    })),
  toggleLock: (slot) =>
    set((state) => ({
      slots: {
        ...state.slots,
        [slot]: {
          ...state.slots[slot],
          locked: !state.slots[slot].locked,
        },
      },
    })),
  setRoi: (slot, roi) =>
    set((state) => ({
      slots: {
        ...state.slots,
        [slot]: {
          ...state.slots[slot],
          roi,
        },
      },
    })),
  addMark: (at, note) =>
    set((state) => ({
      marks: [...state.marks, { id: id(), at, note }],
    })),
  updateStats: (slot, stats) =>
    set((state) => ({
      stats: {
        ...state.stats,
        [slot]: {
          ...state.stats[slot],
          ...stats,
        },
      },
    })),
}))
