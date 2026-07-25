import SectionCard from './SectionCard.jsx'

const money = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
})

function formatMoney(value) {
  return Number.isFinite(value) ? money.format(value) : '無法估算'
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '無法估算'
}

export default function ResultCard({
  result,
  years,
  eyebrow = 'ESTIMATE',
  title = '基本配息結果',
  description = '依目前資料估算；配息全數領出，不再投入。',
  className = '',
}) {
  if (!result) return null

  return (
    <SectionCard
      eyebrow={eyebrow}
      title={title}
      description={description}
      className={`result-card ${className}`}
    >
      <div className="primary-result">
        <span>預估每月配息</span>
        <strong>{formatMoney(result.monthlyDividend)}</strong>
      </div>
      <div className="result-grid">
        <div>
          <span>預估每年配息</span>
          <strong>{formatMoney(result.annualDividend)}</strong>
        </div>
        <div>
          <span>{years} 年累積配息</span>
          <strong>{formatMoney(result.accumulatedDividend)}</strong>
        </div>
        <div>
          <span>年化配息率</span>
          <strong>{formatPercent(result.annualizedDistributionRate)}</strong>
        </div>
      </div>
      <p className="result-note">本結果僅供規劃試算，不代表實際報酬或保證配息。</p>
    </SectionCard>
  )
}
