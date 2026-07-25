function formatDataDate(dataDate) {
  if (!dataDate) return '尚未更新'
  return dataDate.replaceAll('-', '/')
}

function assetFallbackHint(asset) {
  const hints = []
  if (asset?.navStatus === 'previous') hints.push('淨值使用上次資料')
  if (asset?.navStatus === 'fallback') hints.push('淨值使用備援資料')
  if (asset?.distributionStatus === 'previous') {
    hints.push('配息使用上次資料')
  }
  if (asset?.distributionStatus === 'fallback') {
    hints.push('配息使用備援資料')
  }
  return hints.join('、')
}

const navNumber = new Intl.NumberFormat('zh-TW', {
  maximumFractionDigits: 6,
})

function formatNav(nav) {
  const value = Number(nav)
  return Number.isFinite(value) && value > 0
    ? navNumber.format(value)
    : '暫無資料'
}

export default function AllocationEditor({
  rows,
  total,
  isValid,
  onAssetChange,
  onPercentageChange,
  onAdd,
  onRemove,
  assetData,
  enabledAssets,
}) {
  const selectedAssetIds = new Set(rows.map((row) => row.assetId))
  const canAddAsset = rows.length < enabledAssets.length
  const difference = Math.abs(100 - total)
  const formattedTotal = Number(total.toFixed(2))
  const formattedDifference = Number(difference.toFixed(2))

  return (
    <div className="allocation-editor">
      <div className="allocation-heading">
        <div>
          <h3>標的配置</h3>
          <p>選擇標的並設定投入比例。</p>
        </div>
        <span className={`allocation-total ${isValid ? 'is-valid' : ''}`}>
          配置合計：{formattedTotal}%
        </span>
      </div>

      <div className="allocation-rows">
        {rows.map((row, index) => {
          const asset = assetData[row.assetId]
          const fallbackHint = assetFallbackHint(asset)
          const formattedNav = formatNav(asset?.nav)
          const navSourceUrl =
            typeof asset?.navSourceUrl === 'string' &&
            asset.navSourceUrl.trim()
              ? asset.navSourceUrl
              : null

          return (
            <div className="allocation-row" key={row.rowId}>
              <div className="allocation-controls">
                <select
                  value={row.assetId}
                  onChange={(event) =>
                    onAssetChange(row.rowId, event.target.value)
                  }
                  aria-label={`第 ${index + 1} 列標的`}
                >
                  {enabledAssets.map((option) => (
                    <option
                      value={option.assetId}
                      disabled={
                        option.assetId !== row.assetId &&
                        selectedAssetIds.has(option.assetId)
                      }
                      key={option.assetId}
                    >
                      {option.displayName}
                    </option>
                  ))}
                </select>

                <div className="ratio-input">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    inputMode="decimal"
                    value={row.percentage}
                    onChange={(event) =>
                      onPercentageChange(row.rowId, event.target.value)
                    }
                    aria-label={`${asset?.displayName ?? '標的'}配置比例`}
                  />
                  <span>%</span>
                </div>

                <button
                  type="button"
                  className="remove-allocation"
                  onClick={() => onRemove(row.rowId)}
                  disabled={rows.length === 1}
                  aria-label={`刪除${asset?.displayName ?? '標的'}配置`}
                >
                  刪除
                </button>
              </div>
              <div className="asset-metadata">
                <p className="asset-nav">
                  <span>淨值：</span>
                  {navSourceUrl && formattedNav !== '暫無資料' ? (
                    <a
                      href={navSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${asset?.displayName ?? '標的'}淨值 ${formattedNav}，開啟淨值來源`}
                    >
                      {formattedNav}
                      <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    <strong>{formattedNav}</strong>
                  )}
                </p>
                <p className="asset-date">
                  資料更新日期：{formatDataDate(asset?.navDate)}
                  {fallbackHint && ` · ${fallbackHint}`}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="add-allocation"
        onClick={onAdd}
        disabled={!canAddAsset}
      >
        ＋ 新增標的
      </button>

      <div
        className={`allocation-validation ${isValid ? 'is-valid' : ''}`}
        role="status"
        aria-live="polite"
      >
        {isValid && <span>配置合計：100%</span>}
        {!isValid && total < 100 && (
          <span>
            目前合計 {formattedTotal}%，尚差 {formattedDifference}%。
          </span>
        )}
        {!isValid && total > 100 && (
          <span>
            目前合計 {formattedTotal}%，請減少 {formattedDifference}%。
          </span>
        )}
      </div>
    </div>
  )
}
