import { useState } from 'react'

const money = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
})

function formatDifference(value, type) {
  if (!Number.isFinite(value)) return '無法估算'
  const sign = value > 0 ? '+' : ''
  if (type === 'percent') return `${sign}${value.toFixed(2)}%`
  return `${sign}${money.format(value)}`
}

export default function ComparisonResultCard({
  comparison,
  years,
  planAName,
  planBName,
}) {
  const [open, setOpen] = useState(false)
  const resultA = comparison?.a?.dividend ?? null
  const resultB = comparison?.b?.dividend ?? null
  if (!resultA || !resultB) return null

  const rows = [
    {
      label: '預估每月配息',
      a: resultA.monthlyDividend,
      b: resultB.monthlyDividend,
      type: 'money',
    },
    {
      label: '預估每年配息',
      a: resultA.annualDividend,
      b: resultB.annualDividend,
      type: 'money',
    },
    {
      label: `${years} 年累積配息`,
      a: resultA.accumulatedDividend,
      b: resultB.accumulatedDividend,
      type: 'money',
    },
    {
      label: '年化配息率',
      a: resultA.annualizedDistributionRate,
      b: resultB.annualizedDistributionRate,
      type: 'percent',
    },
  ]

  return (
    <section
      className={`comparison-result-card comparison-result-collapse-card ${
        open ? 'is-open' : ''
      }`}
    >
      <button
        type="button"
        className="comparison-result-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div>
          <span className="eyebrow">COMPARE</span>
          <strong>方案比較結果</strong>
          <small>查看方案 B 相較方案 A 的差異摘要</small>
        </div>
        <span
          className={`stress-chevron ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div
        className={`comparison-result-collapse ${open ? 'is-open' : ''}`}
      >
        <div className="comparison-result-inner">
          <div className="comparison-projects">
            <div>
              <span>方案 A</span>
              <strong>{planAName}</strong>
            </div>
            <div>
              <span>方案 B</span>
              <strong>{planBName}</strong>
            </div>
          </div>

          <div className="comparison-difference-list">
            {rows.map((row) => (
              <div className="comparison-difference-row" key={row.label}>
                <span>{row.label}</span>
                <strong>{formatDifference(row.b - row.a, row.type)}</strong>
              </div>
            ))}
          </div>
          <p className="comparison-result-note">
            差異以方案 B 減方案 A 計算；正數表示方案 B 較高。
          </p>
        </div>
      </div>
    </section>
  )
}
