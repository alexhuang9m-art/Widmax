import { useEffect } from 'react'
import { recommendProfile } from './perfProfiles'
import { useLabStore } from '../../store/useLabStore'

export function useAutoGovernor() {
  const stats = useLabStore((s) => s.stats)
  const setProfile = useLabStore((s) => s.setProfile)

  useEffect(() => {
    const dropped = Object.values(stats).reduce((sum, item) => sum + item.droppedFrames, 0)
    const profile = recommendProfile(dropped)
    setProfile(profile)
  }, [setProfile, stats])
}
