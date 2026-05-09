export interface DecodeSupport {
  smooth: boolean
  powerEfficient: boolean
  supported: boolean
}

const CODECS = {
  h264: 'avc1.640032',
  h265: 'hvc1.1.6.L186.B0',
} as const

async function checkCodec(codec: string): Promise<DecodeSupport> {
  if (!('mediaCapabilities' in navigator)) {
    return { smooth: false, powerEfficient: false, supported: false }
  }

  const config: MediaDecodingConfiguration = {
    type: 'file',
    video: {
      contentType: `video/mp4; codecs="${codec}"`,
      width: 3840,
      height: 2160,
      bitrate: 50_000_000,
      framerate: 60,
    },
  }

  try {
    const result = await navigator.mediaCapabilities.decodingInfo(config)
    return {
      smooth: result.smooth,
      powerEfficient: result.powerEfficient,
      supported: result.supported,
    }
  } catch {
    return { smooth: false, powerEfficient: false, supported: false }
  }
}

export async function detectDecodeCapabilities() {
  const [h264, h265] = await Promise.all([
    checkCodec(CODECS.h264),
    checkCodec(CODECS.h265),
  ])

  return { h264, h265 }
}
