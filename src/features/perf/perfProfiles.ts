import type { PerformanceProfile } from '../../types/video'

export interface ProfileConfig {
  label: string
  uiUpdateHz: number
  blurStrength: number
  showHistogram: boolean
}

export const PROFILE_CONFIG: Record<PerformanceProfile, ProfileConfig> = {
  quality: {
    label: 'Quality',
    uiUpdateHz: 20,
    blurStrength: 20,
    showHistogram: true,
  },
  balanced: {
    label: 'Balanced',
    uiUpdateHz: 10,
    blurStrength: 14,
    showHistogram: false,
  },
  performance: {
    label: 'Performance',
    uiUpdateHz: 5,
    blurStrength: 8,
    showHistogram: false,
  },
}

export function recommendProfile(totalDroppedFrames: number): PerformanceProfile {
  if (totalDroppedFrames > 120) return 'performance'
  if (totalDroppedFrames > 40) return 'balanced'
  return 'quality'
}
