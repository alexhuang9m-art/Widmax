export type SlotId = 0 | 1 | 2 | 3

export type LayoutMode = 'single' | 'dual' | 'quad'

export interface VideoSource {
  id: string
  name: string
  url: string
  type: 'local' | 'remote'
  blob?: Blob
}

export interface AnnotationMark {
  id: string
  at: number
  note: string
}

export interface RoiRect {
  x: number
  y: number
  width: number
  height: number
}

export type PerformanceProfile = 'quality' | 'balanced' | 'performance'
