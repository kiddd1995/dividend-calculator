import { useState } from 'react'

const money = new Intl.NumberFormat('zh-TW', {
  maximumFractionDigits: 0,
})

function formatMoney(value) {
  if (!Number.isFinite(value)) return '無法計算'
  const roundedValue = Math.round(value)
  const sign = roundedValue < 0 ? '－' : ''
  return `${sign}NT$${money.format(Math.abs(roundedValue))}`
}

function formatSignedMoney(value) {
  if (!Number.isFinite(value)) return '無法計算'
  const roundedValue = Math.round(value)
  if (roundedValue === 0) return 'NT$0'
  const sign = roundedValue > 0 ? '＋' : '－'
  return `${sign}NT$${money.format(Math.abs(roundedValue))}`
}

function formatPercent(value, digits = 2) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : '無法計算'
}

function valueLengthClass(value) {
  return value.length >= 15 ? 'is-long' : ''
}

function StressSummaryValue({ value, alignRight = false }) {
  return (
    <strong
      className={`stress-summary-value ${valueLengthClass(value)} ${
        alignRight ? 'stress-summary-value--right' : ''
      }`}
    >
      {value}
    </strong>
  )
}

function safetyClass(status) {
  return {
    相對安全: 'is-safe',
    注意: 'is-notice',
    高風險: 'is-high-risk',
    達警戒線: 'is-warning-line',
    極端風險: 'is-extreme-risk',
    未使用: 'is-unused',
  }[status]
}

function SafetyBadge({ status }) {
  return (
    <span className={`stress-safety-badge ${safetyClass(status) ?? ''}`}>
      {status}
    </span>
  )
}

function StressScenarioNote({ result }) {
  if (!result?.enabled || !result.valid) return null
  const note =
    result.scenario === 'normal'
      ? '依設定之一般市場漲跌百分比、配息及費用試算，結果僅供規劃參考，不代表保證收益。'
      : result.scenario === 'extreme'
        ? '以原始投入金額套用設定之極端跌幅及完整費用，結果為保守壓力假設，不代表未來實際結果。'
        : null
  if (!note) return null

  return (
    <p className="stress-scenario-note">
      <span aria-hidden="true">ⓘ</span>
      {note}
    </p>
  )
}

function StressPlaceholder({ result }) {
  if (!result?.enabled) {
    return (
      <div className="stress-placeholder">
        <strong>尚未選擇壓力測試情境</strong>
        <p>請在規劃條件中選擇一般市場試算或極端壓力測試。</p>
      </div>
    )
  }
  if (!result.valid) {
    return (
      <div className="stress-placeholder has-error" role="status">
        <strong>目前無法計算壓力測試</strong>
        <p>{result.error}</p>
      </div>
    )
  }
  return null
}

function AssetDetails({ result, detailsOpen, onToggle }) {
  const isNormalScenario = result.scenario === 'normal'
  return (
    <div className="stress-details">
      <button
        type="button"
        className="stress-details-toggle"
        onClick={onToggle}
        aria-expanded={detailsOpen}
      >
        <span>各標的壓力測試明細</span>
        <span
          className={`stress-chevron ${detailsOpen ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div
        className={`stress-details-collapse ${detailsOpen ? 'is-open' : ''}`}
      >
        <div className="stress-details-inner">
          <div className="stress-asset-list">
            {(result.assetDetails ?? []).map((detail) => (
              <article className="stress-asset-item" key={detail.assetId}>
                <div className="stress-asset-name">
                  <strong>{detail.displayName}</strong>
                  <span>配置 {formatPercent(detail.allocationPercentage)}</span>
                </div>
                <dl>
                  <div>
                    <dt>原始配置金額</dt>
                    <dd>{formatMoney(detail.originalAmount)}</dd>
                  </div>
                  <div>
                    <dt>
                      {isNormalScenario ? '一般市場試算' : '採用跌幅'}
                    </dt>
                    <dd>
                      {formatPercent(
                        isNormalScenario
                          ? detail.marketScenarioDrawdown * 100
                          : detail.drawdown * 100,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{isNormalScenario ? '期末價值' : '壓力後價值'}</dt>
                    <dd>{formatMoney(detail.stressedValue)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StressResultContent({ result, detailsOpen, onDetailsToggle }) {
  const placeholder = <StressPlaceholder result={result} />
  if (!result?.enabled || !result.valid) return placeholder

  const gapLabel = Number.isFinite(result.warningLineGap)
    ? result.warningLineGap >= 0
      ? `尚有 ${result.warningLineGap.toFixed(2)} 個百分點`
      : `已超過 ${Math.abs(result.warningLineGap).toFixed(2)} 個百分點`
    : '無法計算'
  const finalStressedValue = formatMoney(result.finalStressedAccountValue)
  const safetyValueGap = formatSignedMoney(result.safetyValueGap)
  const stressedLoanRatio = formatPercent(result.stressedLoanRatio)
  const observedTotalAssets = formatMoney(result.observedTotalAssets)
  const hasNegativeSafetyGap =
    Number.isFinite(result.safetyValueGap) && result.safetyValueGap < 0
  const hasWarningLoanRatio =
    Number.isFinite(result.stressedLoanRatio) &&
    result.stressedLoanRatio >= 85
  const isNormalScenario = result.scenario === 'normal'

  return (
    <>
      <div className="stress-scenario-row">
        <span>壓力情境</span>
        <strong>{result.scenarioLabel}</strong>
      </div>

      <div
        className={`stress-key-results ${result.useLoan ? '' : 'has-no-loan'}`}
      >
        <div className="is-primary">
          <span>
            {isNormalScenario
              ? '試算期末帳戶價值'
              : '最終壓力後帳戶價值'}
          </span>
          <StressSummaryValue value={finalStressedValue} />
        </div>
        {result.useLoan && (
          <>
            <div className={hasNegativeSafetyGap ? 'is-danger' : ''}>
              <span>資金安全價值差距</span>
              <StressSummaryValue value={safetyValueGap} />
            </div>
            <div className={hasWarningLoanRatio ? 'is-danger' : ''}>
              <span>壓力後貸款比率</span>
              <StressSummaryValue value={stressedLoanRatio} />
              <small className="stress-key-status">
                {result.safetyStatus}
              </small>
            </div>
          </>
        )}
      </div>

      <dl className="stress-metrics">
        <div>
          <dt>原始投入本金</dt>
          <dd>{formatMoney(result.principal)}</dd>
        </div>
        <div>
          <dt>
            {isNormalScenario
              ? '未扣商品費用期末價值'
              : '市場壓力後價值'}
          </dt>
          <dd>{formatMoney(result.marketStressedValue)}</dd>
        </div>
        <div>
          <dt>
            {isNormalScenario
              ? '一般市場加權漲跌幅'
              : '市場壓力加權跌幅'}
          </dt>
          <dd>{formatPercent(result.marketWeightedDrawdownPercentage)}</dd>
        </div>
        <div>
          <dt>試算期間累積商品費用</dt>
          <dd>{formatMoney(result.totalProductFees)}</dd>
        </div>
        <div>
          <dt>
            {isNormalScenario ? '帳戶價值變動金額' : '帳戶價值減少金額'}
          </dt>
          <dd>{formatMoney(result.accountValueDecrease)}</dd>
        </div>
        <div>
          <dt>{isNormalScenario ? '帳戶價值變動率' : '帳戶價值跌幅'}</dt>
          <dd>{formatPercent(result.accountValueDrawdownPercentage)}</dd>
        </div>
        <div>
          <dt>試算期間累積已領配息</dt>
          <dd>{formatMoney(result.accumulatedDividend)}</dd>
        </div>
        <div className="stress-observation">
          <dt>
            {isNormalScenario
              ? '帳戶價值加已領配息'
              : '壓力後帳戶價值加已領配息'}
          </dt>
          <dd
            className={`stress-summary-value stress-summary-value--right ${valueLengthClass(
              observedTotalAssets,
            )}`}
          >
            {observedTotalAssets}
          </dd>
          <small>僅供總資產觀察，不屬於保單帳戶價值。</small>
        </div>
      </dl>

      {result.useLoan && (
        <section className="stress-loan-section">
          <div className="stress-loan-heading">
            <h4>保單貸款壓力結果</h4>
            <SafetyBadge status={result.safetyStatus} />
          </div>
          <dl className="stress-metrics">
            {result.planningMode === 'sponsorProject' && (
              <>
                <div>
                  <dt>自有本金</dt>
                  <dd>{formatMoney(result.ownCapital)}</dd>
                </div>
                <div>
                  <dt>金主借款金額</dt>
                  <dd>{formatMoney(result.sponsorCapital)}</dd>
                </div>
                <div>
                  <dt>保單實際投入本金</dt>
                  <dd>{formatMoney(result.principal)}</dd>
                </div>
              </>
            )}
            <div>
              <dt>保單貸款本金</dt>
              <dd>{formatMoney(result.loanPrincipal)}</dd>
            </div>
            <div className={hasWarningLoanRatio ? 'is-danger-metric' : ''}>
              <dt>壓力後貸款比率</dt>
              <dd className="stress-value">{stressedLoanRatio}</dd>
            </div>
            <div>
              <dt>距離 85% 警戒線</dt>
              <dd>
                {Number.isFinite(result.stressedLoanRatio)
                  ? gapLabel
                  : '無法計算'}
              </dd>
            </div>
            <div>
              <dt>85% 警戒帳戶價值</dt>
              <dd>{formatMoney(result.safeAccountValue)}</dd>
            </div>
            <div className={hasNegativeSafetyGap ? 'is-danger-metric' : ''}>
              <dt>資金安全價值差距</dt>
              <dd className="stress-value">{safetyValueGap}</dd>
            </div>
            <div>
              <dt>需補資金</dt>
              <dd>{formatMoney(result.requiredTopUp)}</dd>
              {result.requiredTopUp === 0 && <small>目前無須補資金</small>}
            </div>
            <div>
              <dt>是否低於警戒帳戶價值</dt>
              <dd>{result.belowWarningAccountValue ? '是' : '否'}</dd>
            </div>
          </dl>
        </section>
      )}

      <AssetDetails
        result={result}
        detailsOpen={detailsOpen}
        onToggle={onDetailsToggle}
      />
      <StressScenarioNote result={result} />
    </>
  )
}

export default function StressTestResult({
  result,
  comparisonEnabled = false,
  comparisonResultA = null,
  comparisonResultB = null,
}) {
  const [open, setOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const sharedComparisonScenario =
    comparisonEnabled &&
    comparisonResultA?.enabled &&
    comparisonResultA.valid &&
    comparisonResultB?.enabled &&
    comparisonResultB.valid &&
    comparisonResultA.scenario === comparisonResultB.scenario
      ? comparisonResultA
      : null

  return (
    <section className={`stress-result-card ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="stress-result-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div>
          <span className="eyebrow">STRESS TEST</span>
          <strong>壓力測試結果</strong>
        </div>
        <span
          className={`stress-chevron ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div className={`stress-result-collapse ${open ? 'is-open' : ''}`}>
        <div className="stress-result-inner">
          <div className="stress-result-content">
            <StressResultContent
              result={result}
              detailsOpen={detailsOpen}
              onDetailsToggle={() =>
                setDetailsOpen((current) => !current)
              }
            />
            {comparisonEnabled && (
              <section className="comparison-stress-area">
                <div className="comparison-stress-area-heading">
                  <span className="eyebrow">COMPARE STRESS</span>
                  <h3>兩方案壓力測試摘要</h3>
                  <p>方案 A、B 依各自實際配置計算。</p>
                </div>
                <div className="comparison-stress-grid">
                  <ComparisonStressSummary
                    title="方案 A 壓力摘要"
                    result={comparisonResultA}
                    showScenarioNote={!sharedComparisonScenario}
                  />
                  <ComparisonStressSummary
                    title="方案 B 壓力摘要"
                    result={comparisonResultB}
                    showScenarioNote={!sharedComparisonScenario}
                  />
                </div>
                {sharedComparisonScenario && (
                  <StressScenarioNote result={sharedComparisonScenario} />
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export function ComparisonStressSummary({
  title,
  result,
  showScenarioNote = true,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const finalStressedValue = formatMoney(result?.finalStressedAccountValue)
  const safetyValueGap = formatSignedMoney(result?.safetyValueGap)
  const stressedLoanRatio = formatPercent(result?.stressedLoanRatio)
  const observedTotalAssets = formatMoney(result?.observedTotalAssets)
  const hasNegativeSafetyGap =
    Number.isFinite(result?.safetyValueGap) && result.safetyValueGap < 0
  const hasWarningLoanRatio =
    Number.isFinite(result?.stressedLoanRatio) &&
    result.stressedLoanRatio >= 85
  const isNormalScenario = result?.scenario === 'normal'

  return (
    <section className="comparison-stress-summary">
      <div className="comparison-stress-heading">
        <span>{title}</span>
        {result?.enabled && result.valid && result.useLoan && (
          <SafetyBadge status={result.safetyStatus} />
        )}
      </div>
      <StressPlaceholder result={result} />
      {result?.enabled && result.valid && (
        <>
          <dl className="comparison-stress-metrics">
            <div>
              <dt>壓力情境</dt>
              <dd>{result.scenarioLabel}</dd>
            </div>
            <div>
              <dt>
                {isNormalScenario
                  ? '未扣商品費用期末價值'
                  : '市場壓力後價值'}
              </dt>
              <dd>{formatMoney(result.marketStressedValue)}</dd>
            </div>
            <div>
              <dt>試算期間累積商品費用</dt>
              <dd>{formatMoney(result.totalProductFees)}</dd>
            </div>
            <div>
              <dt>
                {isNormalScenario
                  ? '試算期末帳戶價值'
                  : '最終壓力後帳戶價值'}
              </dt>
              <dd
                className={`stress-summary-value ${valueLengthClass(
                  finalStressedValue,
                )}`}
              >
                {finalStressedValue}
              </dd>
            </div>
            <div>
              <dt>
                {isNormalScenario
                  ? '一般市場加權漲跌幅'
                  : '市場壓力加權跌幅'}
              </dt>
              <dd>{formatPercent(result.marketWeightedDrawdownPercentage)}</dd>
            </div>
            {result.useLoan ? (
              <>
                <div>
                  <dt>85% 警戒帳戶價值</dt>
                  <dd>{formatMoney(result.safeAccountValue)}</dd>
                </div>
                <div
                  className={hasNegativeSafetyGap ? 'is-danger-metric' : ''}
                >
                  <dt>資金安全價值差距</dt>
                  <dd
                    className={`stress-summary-value ${valueLengthClass(
                      safetyValueGap,
                    )}`}
                  >
                    {safetyValueGap}
                  </dd>
                </div>
                <div>
                  <dt>需補資金</dt>
                  <dd>{formatMoney(result.requiredTopUp)}</dd>
                </div>
                <div
                  className={hasWarningLoanRatio ? 'is-danger-metric' : ''}
                >
                  <dt>壓力後貸款比率</dt>
                  <dd
                    className={`stress-summary-value ${valueLengthClass(
                      stressedLoanRatio,
                    )}`}
                  >
                    {stressedLoanRatio}
                  </dd>
                  <small>{result.safetyStatus}</small>
                </div>
                <div>
                  <dt>安全狀態</dt>
                  <dd>{result.safetyStatus}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>
                  {isNormalScenario ? '帳戶價值變動率' : '帳戶價值跌幅'}
                </dt>
                <dd>{formatPercent(result.accountValueDrawdownPercentage)}</dd>
              </div>
            )}
            <div className="is-observation">
              <dt>
                {isNormalScenario
                  ? '帳戶價值加已領配息'
                  : '壓力後帳戶價值加已領配息'}
              </dt>
              <dd
                className={`stress-summary-value stress-summary-value--right ${valueLengthClass(
                  observedTotalAssets,
                )}`}
              >
                {observedTotalAssets}
              </dd>
              <small>僅供總資產觀察，不屬於保單帳戶價值。</small>
            </div>
          </dl>
          <AssetDetails
            result={result}
            detailsOpen={detailsOpen}
            onToggle={() => setDetailsOpen((current) => !current)}
          />
          {showScenarioNote && <StressScenarioNote result={result} />}
        </>
      )}
    </section>
  )
}
