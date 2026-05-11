export const WAVEFORM_SAMPLE_RATE_HZ = 8000

function toMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer
  if (numberOfChannels === 1) return buffer.getChannelData(0).slice()
  const mono = new Float32Array(length)
  for (let c = 0; c < numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i += 1) mono[i] += data[i]
  }
  for (let i = 0; i < length; i += 1) mono[i] /= numberOfChannels
  return mono
}

function downsample(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return samples
  const ratio = sourceRate / targetRate
  const outLength = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i * ratio
    const left = Math.floor(srcPos)
    const right = Math.min(left + 1, samples.length - 1)
    const t = srcPos - left
    out[i] = samples[left] * (1 - t) + samples[right] * t
  }
  return out
}

/**
 * RMS loudness envelope at 8kHz conceptual rate, bucketed along `timelineDurationSec`
 * (typically video duration so the strip aligns with the scrub bar).
 */
export async function extractLoudnessPeaks8k(
  blob: Blob,
  timelineDurationSec: number,
  createCtx: () => AudioContext,
): Promise<number[]> {
  const ctx = createCtx()
  try {
    const ab = await blob.arrayBuffer()
    const buffer = await ctx.decodeAudioData(ab.slice(0))
    const mono = toMono(buffer)
    const at8k = downsample(mono, buffer.sampleRate, WAVEFORM_SAMPLE_RATE_HZ)
    const audioSpanSec = at8k.length / WAVEFORM_SAMPLE_RATE_HZ
    const duration = Math.max(timelineDurationSec, 1e-3)

    const bucketCount = Math.min(2000, Math.max(400, Math.floor(duration * 16)))
    const peaks = new Array<number>(bucketCount)

    for (let b = 0; b < bucketCount; b += 1) {
      const t0 = (b / bucketCount) * duration
      const t1 = ((b + 1) / bucketCount) * duration
      let i0 = Math.floor(t0 * WAVEFORM_SAMPLE_RATE_HZ)
      let i1 = Math.floor(t1 * WAVEFORM_SAMPLE_RATE_HZ)
      i0 = Math.max(0, Math.min(i0, at8k.length))
      i1 = Math.max(i0, Math.min(i1, at8k.length))
      const n = Math.max(1, i1 - i0)
      let sumSq = 0
      for (let i = i0; i < i1; i += 1) {
        const v = at8k[i] ?? 0
        sumSq += v * v
      }
      peaks[b] = Math.sqrt(sumSq / n)
    }

    const maxV = peaks.reduce((m, v) => Math.max(m, v), 1e-12)
    for (let b = 0; b < bucketCount; b += 1) peaks[b] /= maxV

    if (audioSpanSec + 0.05 < duration) {
      const fillFrom = Math.floor((audioSpanSec / duration) * bucketCount)
      for (let b = fillFrom; b < bucketCount; b += 1) peaks[b] = 0
    }

    return peaks
  } finally {
    await ctx.close()
  }
}
