import Field from './Field.jsx'

const loanRates = [
  { value: '3.85', label: '3.85%' },
  { value: '4', label: '4%' },
  { value: '5.12', label: '5.12%' },
  { value: 'custom', label: '自訂' },
]

const stressOptions = [
  { value: 'none', label: '不進行壓力測試' },
  { value: 'normal', label: '一般市場試算' },
  { value: 'extreme', label: '極端壓力測試' },
]

function ChoiceGroup({ name, value, onChange, options }) {
  return (
    <div className="choice-group">
      {options.map((option) => (
        <label
          className={`choice ${value === option.value ? 'is-selected' : ''}`}
          key={option.value}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={(event) => onChange(event.target.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

function formatFeeRule(feePlan) {
  return feePlan.periods
    .map((period) => {
      const rate = (period.monthlyFeeRate * 100).toFixed(2)
      return `第 ${period.fromMonth} 至 ${period.toMonth} 個月每月 ${rate}%`
    })
    .join('、')
}

function AmountField({ label, value, onChange, readOnly = false }) {
  return (
    <Field label={label}>
      <div className="input-with-unit">
        <input
          type="number"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          aria-label={`${label}，單位萬元`}
        />
        <span>萬元</span>
      </div>
    </Field>
  )
}

function formatLinkedValue(value) {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(2)
}

export default function PlanningOptions({
  options,
  onChange,
  feePlans,
  principalWan,
  showSponsorProjectHint,
  policyLoanError,
  generateDisabled,
  generateMessage,
  onGenerate,
}) {
  const setOption = (key, value) => onChange({ ...options, [key]: value })
  const setPlanningMode = (planningMode) => {
    const nextOptions = { ...options, planningMode }
    if (
      planningMode === 'sponsorProject' &&
      options.planningMode !== 'sponsorProject' &&
      (Number(options.sponsorCapitalWan) || 0) === 0
    ) {
      nextOptions.sponsorCapitalWan = principalWan
    }
    onChange(nextOptions)
  }
  const setPolicyLoanRatio = (value) => {
    const numericPrincipal = Number(principalWan)
    const numericRatio = Number(value)
    const linkedAmount =
      numericPrincipal > 0 && Number.isFinite(numericRatio)
        ? (numericPrincipal * numericRatio) / 100
        : ''
    onChange({
      ...options,
      policyLoanRatio: value,
      policyLoanAmountWan:
        linkedAmount === '' ? '' : formatLinkedValue(linkedAmount),
      policyLoanInputSource: 'ratio',
    })
  }
  const setPolicyLoanAmount = (value) => {
    const numericPrincipal = Number(principalWan)
    const numericAmount = Number(value)
    const linkedRatio =
      numericPrincipal > 0 && Number.isFinite(numericAmount)
        ? (numericAmount / numericPrincipal) * 100
        : ''
    onChange({
      ...options,
      policyLoanAmountWan: value,
      policyLoanRatio:
        linkedRatio === '' ? '' : formatLinkedValue(linkedRatio),
      policyLoanInputSource: 'amount',
    })
  }
  const selectedLoanRate =
    options.loanRatePreset === 'custom'
      ? Number(options.customLoanRate) || 0
      : Number(options.loanRatePreset)
  const feeOptions = feePlans.map((feePlan) => ({
    value: feePlan.id,
    label: feePlan.name,
  }))
  const selectedFeePlan = feePlans.find(
    (feePlan) => feePlan.id === options.feeType,
  )
  const ownCapitalWan = Math.max(Number(principalWan) || 0, 0)
  const sponsorCapitalWan = Math.max(
    Number(options.sponsorCapitalWan) || 0,
    0,
  )
  const policyInvestedCapitalWan = ownCapitalWan + sponsorCapitalWan
  const isSponsorProject = options.planningMode === 'sponsorProject'
  const usesLoan = options.planningMode !== 'none'

  return (
    <div className="planning-content">
      <div className="planning-group">
        <div className="subheading">
          <span className="step-number">01</span>
          <div>
            <h3>資金規劃模式</h3>
            <p>標的配置與資金規劃彼此獨立，貸款利息不滾入本金。</p>
          </div>
        </div>
        {showSponsorProjectHint && (
          <p className="sponsor-project-hint">
            此配置可搭配金主專案資金模式試算。
          </p>
        )}
        <ChoiceGroup
          name="planning-mode"
          value={options.planningMode || 'none'}
          onChange={setPlanningMode}
          options={[
            { value: 'none', label: '無貸款規劃' },
            { value: 'policyLoan', label: '一般保單貸款' },
            { value: 'sponsorProject', label: '金主專案' },
          ]}
        />

        {usesLoan && (
          <div className="conditional-fields">
            {isSponsorProject ? (
              <>
                <AmountField
                  label="自有資金"
                  value={principalWan}
                  readOnly
                />
                <AmountField
                  label="金主借款金額"
                  value={options.sponsorCapitalWan}
                  onChange={(event) =>
                    setOption('sponsorCapitalWan', event.target.value)
                  }
                />
                <AmountField
                  label="保單實際投入本金"
                  value={policyInvestedCapitalWan}
                  readOnly
                />
              </>
            ) : (
              <>
                <Field label="保單貸款比例">
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={options.policyLoanRatio}
                      onChange={(event) =>
                        setPolicyLoanRatio(event.target.value)
                      }
                      aria-label="保單貸款比例"
                    />
                    <span>%</span>
                  </div>
                </Field>
                <AmountField
                  label="保單借款金額"
                  value={options.policyLoanAmountWan}
                  onChange={(event) =>
                    setPolicyLoanAmount(event.target.value)
                  }
                />
                {policyLoanError && (
                  <div className="risk-warning" role="alert">
                    <strong>無法產生規劃</strong>
                    <span>{policyLoanError}</span>
                  </div>
                )}
                <p className="rule-note">
                  保單貸款資金視為領出使用，不會重新投入目前標的配置。
                </p>
              </>
            )}

            <Field label="保單貸款利率">
              <select
                value={options.loanRatePreset}
                onChange={(event) =>
                  setOption('loanRatePreset', event.target.value)
                }
              >
                {loanRates.map((rate) => (
                  <option value={rate.value} key={rate.value}>
                    {rate.label}
                  </option>
                ))}
              </select>
            </Field>

            {options.loanRatePreset === 'custom' && (
              <Field label="自訂年利率">
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={options.customLoanRate}
                    onChange={(event) =>
                      setOption('customLoanRate', event.target.value)
                    }
                    aria-label="自訂年利率"
                  />
                  <span>%</span>
                </div>
              </Field>
            )}
            <input type="hidden" value={selectedLoanRate} readOnly />
            {isSponsorProject && (
              <p className="rule-note">
                保單貸款金額等同金主借款金額，貸款後全數歸還金主。
              </p>
            )}
          </div>
        )}
      </div>

      <div className="planning-group">
        <div className="subheading">
          <span className="step-number">02</span>
          <div>
            <h3>商品費用</h3>
            <p>費用影響保單帳戶價值，不直接從配息扣除。</p>
          </div>
        </div>
        <ChoiceGroup
          name="fee-type"
          value={options.feeType}
          onChange={(value) => setOption('feeType', value)}
          options={feeOptions}
        />
        {selectedFeePlan && (
          <p className="rule-note">
            {formatFeeRule(selectedFeePlan)}，之後為 0。
          </p>
        )}
      </div>

      <div className="planning-group">
        <div className="subheading">
          <span className="step-number">03</span>
          <div>
            <h3>壓力測試</h3>
            <p>依各標的資料設定模擬一次性價格下跌。</p>
          </div>
        </div>
        <ChoiceGroup
          name="stress-type"
          value={options.stressType}
          onChange={(value) => setOption('stressType', value)}
          options={stressOptions}
        />
      </div>

      <div className="planning-generate-actions">
        {generateMessage && (
          <p className="planning-generate-message" role="status">
            {generateMessage}
          </p>
        )}
        <button
          type="button"
          className="calculate-button planning-generate-button"
          onClick={onGenerate}
          disabled={generateDisabled}
        >
          <span>產生規劃</span>
          <span aria-hidden="true">↓</span>
        </button>
      </div>
    </div>
  )
}
