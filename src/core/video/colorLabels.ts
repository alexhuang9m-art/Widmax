/** ITU-T H.273 / ISO 23001-8 colour_primaries */
export function primariesLabel(p: number): string {
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

export function transferLabel(t: number): string {
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

export function matrixLabel(m: number): string {
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

/** Same wording as `colr`/`nclx` HUD lines (optional full-range suffix). */
export function formatIso23001ColorDescription(
  primaries: number,
  transfer: number,
  matrix: number,
  fullRange?: boolean | null,
): string {
  const parts = [
    `色域基色 ${primariesLabel(primaries)}`,
    `传递特性 ${transferLabel(transfer)}`,
    `矩阵系数 ${matrixLabel(matrix)}`,
  ]
  if (fullRange != null) parts.push(fullRange ? '全范围' : '有限范围')
  return parts.join(' · ')
}
