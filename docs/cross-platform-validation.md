# Cross Platform Validation Report

## Scope
- Product: Widmax Video Lab (Chrome web app)
- Goal: 4x 4K playback readiness for Windows/macOS Chrome
- Code baseline: current workspace HEAD

## Executed Checks (Local)
- `npm run build`: pass
- `npm run lint`: pass
- Core flow sanity: local file import, play/pause, frame step, ROI draw, snapshot export

## Chrome Validation Matrix

### macOS Chrome
- Device: to be filled
- Chrome version: to be filled
- Codec sample set:
  - 4K H.264 60fps
  - 4K H.265 60fps
- Cases:
  1. Quad layout playback for 10 minutes
  2. A/B quick compare toggling
  3. Annotation mark + jump seek
  4. Snapshot capture from each slot
  5. Performance profile auto-switch under stress
- Record:
  - Avg FPS per slot: to be filled
  - Dropped frames total: to be filled
  - Interaction latency: to be filled

### Windows Chrome
- Device: to be filled
- Chrome version: to be filled
- Codec sample set:
  - 4K H.264 60fps
  - 4K H.265 60fps
- Cases:
  1. Quad layout playback for 10 minutes
  2. A/B quick compare toggling
  3. Annotation mark + jump seek
  4. Snapshot capture from each slot
  5. Performance profile auto-switch under stress
- Record:
  - Avg FPS per slot: to be filled
  - Dropped frames total: to be filled
  - Interaction latency: to be filled

## Acceptance Gates
- No hard stutter during 10-minute 4x4K playback on target device
- Play/pause and A/B switch visible response under 100ms
- Feature completeness: import, sync, frame-step, ROI, mark, snapshot
