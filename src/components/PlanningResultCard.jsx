import SectionCard from './SectionCard.jsx'

const money = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
})

const modeLabels = {
  none: '無貸款規劃',
  policyLoan: '一般保單貸款',
  sponsorProject: '金主專案',
}

function formatMoney(value) {
  return Number.isFinite(value) ? money.format(value) : '無法計算'
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '無法計算'
}

function Metric({
  label,
  value,
  featured = false,
  policyHighlight = false,
}) {
  const classNames = [
    featured ? 'is-featured' : '',
    policyHighlight ? 'is-policy-highlight' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classNames}>
      <span>{label}</span>
      <strong>{formatMoney(value)}</strong>
    </div>
  )
}

function TextMetric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || '未設定'}</strong>
    </div>
  )
}

export default function PlanningResultCard({ result, years, dirty = false }) {
  if (!result) return null
  const isNoLoanPlanning = result.planningMode === 'none'
  const isSponsorProject = result.planningMode === 'sponsorProject'
  const isPolicyLoan = result.planningMode === 'policyLoan'

  if (dirty) {
    return (
      <SectionCard
        eyebrow="PLANNING CASHFLOW"
        title="規劃配息結果"
        description="規劃條件已變更，請重新產生規劃。"
        className="planning-result-card is-dirty"
      >
        <div className="planning-stale-notice" role="status">
          舊結果已暫停顯示，請回到規劃條件按下「產生規劃」。
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      eyebrow="PLANNING CASHFLOW"
      title="規劃配息結果"
      description={
        isSponsorProject
          ? '金主專案以實際投入計算毛配息，並呈現扣除貸款利息後的現金流。'
          : isPolicyLoan
            ? '一般保單貸款資金領出使用；貸款利息為額外年度支出，不從配息扣除。'
            : '依保單投入本金計算配息、商品費用與試算期末帳戶價值。'
      }
      className="planning-result-card"
    >
      <div className="planning-mode-summary">
        <span>資金規劃模式</span>
        <strong>{modeLabels[result.planningMode]}</strong>
      </div>

      <div className="planning-capital-grid">
        {isSponsorProject ? (
          <>
            <Metric label="自有本金" value={result.ownCapital} />
            <Metric label="金主借款金額" value={result.sponsorCapital} />
            <Metric
              label="保單實際投入本金"
              value={result.policyInvestedCapital}
              featured
            />
          </>
        ) : isPolicyLoan ? (
          <>
            <Metric label="保單借款金額" value={result.policyLoanAmount} />
            <div>
              <span>保單貸款比例</span>
              <strong>{formatPercent(result.policyLoanRatio)}</strong>
            </div>
            <div>
              <span>保單貸款利率</span>
              <strong>{formatPercent(result.loanInterestRate)}</strong>
            </div>
          </>
        ) : (
          <Metric
            label="保單投入本金"
            value={result.policyInvestedCapital}
            featured
          />
        )}
        {isSponsorProject && (
          <div>
            <span>初始帳戶貸款比率</span>
            <strong>{formatPercent(result.initialAccountLoanRatio)}</strong>
          </div>
        )}
      </div>

      <div className="planning-cashflow-section">
        <h3>
          {isSponsorProject
            ? '每月現金流'
            : isPolicyLoan
              ? '配息與貸款資訊'
              : '配息資訊'}
        </h3>
        <div className="planning-flow-grid">
          <Metric
            label="每月毛配息"
            value={result.monthlyGrossDistribution}
            policyHighlight={!isSponsorProject}
          />
          {isSponsorProject && (
            <>
              <Metric
                label="每月平均利息成本"
                value={result.monthlyInterestReserve}
              />
              <Metric
                label="每月扣息後淨配息"
                value={result.monthlyNetDistribution}
                featured
              />
            </>
          )}
        </div>
      </div>

      <div className="planning-cashflow-section">
        <h3>年度現金流</h3>
        <div className="planning-flow-grid">
          <Metric
            label="每年毛配息"
            value={result.annualGrossDistribution}
            policyHighlight={!isSponsorProject}
          />
          {!isNoLoanPlanning && (
            <Metric
              label={
                isSponsorProject
                  ? '年度保單貸款利息'
                  : '每年保單貸款利息'
              }
              value={result.annualLoanInterest}
              policyHighlight={isPolicyLoan}
            />
          )}
          {isSponsorProject && (
            <Metric
              label="年度扣息後淨配息"
              value={result.annualNetDistribution}
              featured
            />
          )}
        </div>
      </div>

      <div className="planning-cashflow-section">
        <h3>{years} 年累積現金流</h3>
        <div className="planning-flow-grid">
          <Metric
            label="試算期間累積毛配息"
            value={result.cumulativeGrossDistribution}
          />
          {!isNoLoanPlanning && (
            <Metric
              label="試算期間累積保單貸款利息"
              value={result.cumulativeLoanInterest}
            />
          )}
          {isSponsorProject && (
            <Metric
              label="試算期間累積扣息後淨配息"
              value={result.cumulativeNetDistribution}
              featured
            />
          )}
        </div>
      </div>

      {isNoLoanPlanning && (
        <div className="planning-cashflow-section">
          <h3>商品費用與帳戶價值</h3>
          <div className="planning-flow-grid">
            <TextMetric
              label="商品費用方案"
              value={result.feePlanName}
            />
            <Metric
              label="試算期間累積商品費用"
              value={result.totalProductFees}
            />
            <Metric
              label="試算期末推估帳戶價值"
              value={result.projectedAccountValue}
              featured
            />
          </div>
        </div>
      )}

      {isNoLoanPlanning && (
        <div className="planning-rate-grid">
          <div>
            <span>毛配息率</span>
            <strong>{formatPercent(result.grossDistributionRate)}</strong>
            <small>年度毛配息 ÷ 保單投入本金</small>
          </div>
        </div>
      )}

      {isSponsorProject && (
        <div className="planning-rate-grid">
          <div>
            <span>標的毛配息率</span>
            <strong>{formatPercent(result.grossDistributionRate)}</strong>
            <small>年度毛配息 ÷ 保單實際投入本金</small>
          </div>
          <div>
            <span>自有資金淨現金流率</span>
            <strong>{formatPercent(result.netCashflowRateOnOwnCapital)}</strong>
            <small>資金規劃效果，並非基金配息率。</small>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
