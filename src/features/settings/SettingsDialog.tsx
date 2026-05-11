import type { AlignCacheEntry } from '../../core/align-cache'
import type { ManualAlignCacheEntry } from '../../core/manual-align-cache'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  alignCacheEntries: AlignCacheEntry[]
  onDeleteAlignEntry: (id: string) => void
  onClearAlignCache: () => void
  manualAlignCacheEntries: ManualAlignCacheEntry[]
  onDeleteManualAlignEntry: (id: string) => void
  onClearManualAlignCache: () => void
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return String(ts)
  }
}

export function SettingsDialog({
  open,
  onClose,
  alignCacheEntries,
  onDeleteAlignEntry,
  onClearAlignCache,
  manualAlignCacheEntries,
  onDeleteManualAlignEntry,
  onClearManualAlignCache,
}: SettingsDialogProps) {
  if (!open) return null

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="settings-dialog glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2 id="settings-dialog-title" className="settings-dialog-title">
            设置
          </h2>
          <button type="button" className="mini-btn settings-close-btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <section className="settings-section" aria-labelledby="align-cache-heading">
          <h3 id="align-cache-heading" className="settings-section-title">
            自动对齐缓存
          </h3>
          <p className="settings-section-hint">
            相同文件组合再次点击「自动对齐」时将直接使用缓存偏移，无需重新解码与互相关计算。删除条目或清空后，下次对齐会重新计算。
          </p>
          {alignCacheEntries.length === 0 ? (
            <p className="settings-empty muted">暂无缓存</p>
          ) : (
            <ul className="settings-align-list">
              {alignCacheEntries.map((entry) => (
                <li key={entry.id} className="settings-align-row">
                  <div className="settings-align-meta">
                    <div className="settings-align-when">{formatWhen(entry.createdAt)}</div>
                    <div className="settings-align-detail" title={entry.referenceLabel}>
                      <span className="settings-align-k">基准</span>
                      <span className="settings-align-v">{entry.referenceLabel}</span>
                    </div>
                    <div
                      className="settings-align-detail"
                      title={entry.otherLabels.join(' · ')}
                    >
                      <span className="settings-align-k">其余</span>
                      <span className="settings-align-v">
                        {entry.otherLabels.length > 0
                          ? entry.otherLabels.join(' · ')
                          : '—'}
                      </span>
                    </div>
                    <div className="settings-align-lags">
                      偏移（秒）：{entry.lagsSec.map((s) => s.toFixed(3)).join(', ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mini-btn settings-align-delete"
                    onClick={() => onDeleteAlignEntry(entry.id)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {alignCacheEntries.length > 0 ? (
            <button type="button" className="mini-btn settings-clear-all" onClick={onClearAlignCache}>
              清空全部对齐缓存
            </button>
          ) : null}
        </section>

        <section className="settings-section" aria-labelledby="manual-align-cache-heading">
          <h3 id="manual-align-cache-heading" className="settings-section-title">
            手动对齐缓存
          </h3>
          <p className="settings-section-hint">
            保存的对齐相对自动对齐优先：存在手动缓存时，总进度条以组内<strong>最长时长</strong>的视频为基准（并列则<strong>最左侧</strong>分格）。删除或清空后恢复为原生同步拖动。
          </p>
          {manualAlignCacheEntries.length === 0 ? (
            <p className="settings-empty muted">暂无缓存</p>
          ) : (
            <ul className="settings-align-list">
              {manualAlignCacheEntries.map((entry) => (
                <li key={entry.id} className="settings-align-row">
                  <div className="settings-align-meta">
                    <div className="settings-align-when">{formatWhen(entry.createdAt)}</div>
                    <div className="settings-align-detail" title={entry.baselineLabel}>
                      <span className="settings-align-k">基准</span>
                      <span className="settings-align-v">{entry.baselineLabel}</span>
                    </div>
                    <div className="settings-align-lags">
                      各轨相对基准（秒）：{' '}
                      {Object.entries(entry.offsetsBySignature)
                        .map(([sig, sec]) => {
                          const name = sig.split('\u001f')[0] ?? sig
                          return `${name}: ${sec >= 0 ? '+' : ''}${sec.toFixed(3)}`
                        })
                        .join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mini-btn settings-align-delete"
                    onClick={() => onDeleteManualAlignEntry(entry.id)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {manualAlignCacheEntries.length > 0 ? (
            <button type="button" className="mini-btn settings-clear-all" onClick={onClearManualAlignCache}>
              清空全部手动对齐缓存
            </button>
          ) : null}
        </section>
      </div>
    </div>
  )
}
