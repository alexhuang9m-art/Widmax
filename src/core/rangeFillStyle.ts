import type { CSSProperties } from 'react'

/** Drives `--range-fill-pct` for Widmax range inputs (WebKit gradient + Firefox progress). */
export function widmaxRangeFillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min
  const pct =
    Number.isFinite(span) && span > 0
      ? Math.min(100, Math.max(0, ((value - min) / span) * 100))
      : 0
  return { ['--range-fill-pct']: `${pct}%` } as CSSProperties
}
