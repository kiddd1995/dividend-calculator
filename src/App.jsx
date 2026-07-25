import { useEffect, useMemo, useRef, useState } from 'react'
import ComparisonResultCard from './components/ComparisonResultCard.jsx'
import Field from './components/Field.jsx'
import PlanningOptions from './components/PlanningOptions.jsx'
import PlanningResultCard from './components/PlanningResultCard.jsx'
import ProjectConfigurator from './components/ProjectConfigurator.jsx'
import ResultCard from './components/ResultCard.jsx'
import SectionCard from './components/SectionCard.jsx'
import StressTestResult from './components/StressTestResult.jsx'
import {
  getPrimaryExchangeRate,
  isExchangeRateStale,
  loadAppData,
} from './data/loadData.js'
import {
  calculateDividendResult,
  calculatePlanningResult,
  calculateStressTestResult,
  resolvePolicyLoanTerms,
} from './utils/calculator.js'

const CUSTOM_PROJECT_ID = 'custom'

const initialPlanningOptions = {
  planningMode: 'none',
  policyLoanRatio: '40',
  policyLoanAmountWan: '40',
  policyLoanInputSource: 'ratio',
  loanRatePreset: '3.85',
  customLoanRate: '3.85',
  sponsorCapitalWan: 0,
  feeType: 'none',
  stressType: 'none',
}

function createRowsFromAllocations(allocations, prefix) {
  return Object.entries(allocations).map(([assetId, percentage], index) => ({
    rowId: `${prefix}-preset-${index + 1}`,
    assetId,
    percentage: String(percentage),
  }))
}

function formatLinkedInput(value) {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(2)
}

function createBasicComparisonSignature({
  principalWan,
  years,
  allocations,
  usdRate,
}) {
  const normalizedAllocations = Object.entries(allocations)
    .map(([assetId, percentage]) => [
      assetId,
      Number(percentage).toFixed(6),
    ])
    .sort(([assetIdA], [assetIdB]) => assetIdA.localeCompare(assetIdB))

  return JSON.stringify({
    principalWan: Number(principalWan),
    years: Number(years),
    allocations: normalizedAllocations,
    usdSpotBuyingRate: Number(usdRate?.spotBuyingRate),
    usdSpotSellingRate: Number(usdRate?.spotSellingRate),
    usdRateDate: usdRate?.rateDate ?? null,
  })
}

function useProjectConfiguration({
  defaultPlan,
  fixedPlans,
  enabledAssets,
  prefix,
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(defaultPlan.id)
  const [allocationRows, setAllocationRows] = useState(() =>
    createRowsFromAllocations(defaultPlan.allocations, prefix),
  )
  const nextRowId = useRef(1)

  const totalAllocation = useMemo(
    () =>
      allocationRows.reduce(
        (total, row) => total + (Number(row.percentage) || 0),
        0,
      ),
    [allocationRows],
  )
  const isAllocationValid = Math.abs(totalAllocation - 100) < 0.0001
  const allocations = useMemo(
    () =>
      Object.fromEntries(
        allocationRows.map((row) => [
          row.assetId,
          Number(row.percentage) || 0,
        ]),
      ),
    [allocationRows],
  )

  const markAsCustom = (nextRows) => {
    setAllocationRows(nextRows)
    setSelectedProjectId(CUSTOM_PROJECT_ID)
  }

  const changeProject = (nextProjectId) => {
    if (nextProjectId === CUSTOM_PROJECT_ID) {
      setSelectedProjectId(CUSTOM_PROJECT_ID)
      return
    }

    const shouldSwitch = window.confirm(
      '切換專案將恢復該專案的預設配置，是否繼續？',
    )
    if (!shouldSwitch) return

    const nextProject = fixedPlans.find((plan) => plan.id === nextProjectId)
    if (!nextProject) return
    setSelectedProjectId(nextProject.id)
    setAllocationRows(
      createRowsFromAllocations(nextProject.allocations, prefix),
    )
  }

  const changeAsset = (rowId, assetId) => {
    markAsCustom(
      allocationRows.map((row) =>
        row.rowId === rowId ? { ...row, assetId } : row,
      ),
    )
  }

  const changePercentage = (rowId, value) => {
    if (
      value !== '' &&
      (!Number.isFinite(Number(value)) ||
        Number(value) < 0 ||
        Number(value) > 100)
    ) {
      return
    }
    markAsCustom(
      allocationRows.map((row) =>
        row.rowId === rowId ? { ...row, percentage: value } : row,
      ),
    )
  }

  const addAsset = () => {
    const selectedIds = new Set(allocationRows.map((row) => row.assetId))
    const availableAsset = enabledAssets.find(
      (asset) => !selectedIds.has(asset.assetId),
    )
    if (!availableAsset) return

    markAsCustom([
      ...allocationRows,
      {
        rowId: `${prefix}-custom-${nextRowId.current++}`,
        assetId: availableAsset.assetId,
        percentage: '0',
      },
    ])
  }

  const removeAsset = (rowId) => {
    if (allocationRows.length === 1) return
    markAsCustom(allocationRows.filter((row) => row.rowId !== rowId))
  }

  return {
    selectedProjectId,
    allocationRows,
    totalAllocation,
    isAllocationValid,
    allocations,
    changeProject,
    changeAsset,
    changePercentage,
    addAsset,
    removeAsset,
  }
}

function formatDate(date) {
  return date ? date.replaceAll('-', '/') : '尚未更新'
}

function exchangeFallbackHint(rate) {
  if (rate?.fallbackLevel === 'secondary') return '主要來源暫時無法使用，已改用備援來源。'
  if (rate?.fallbackLevel === 'previous') return '目前使用上次成功取得的匯率。'
  if (rate?.fallbackLevel === 'manual') return '目前使用 Excel 備援匯率。'
  return null
}

function SiteHeader() {
  return (
    <header className="hero">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <span className="hero-kicker">DIVIDEND PLANNER</span>
        <h1>配息計算機</h1>
        <p>依最新淨值與配息資料，試算預估配息與規劃結果。</p>
      </div>
    </header>
  )
}

function CalculatorApp({ appData }) {
  const {
    assetData,
    enabledAssets,
    fixedPlans,
    defaultProjectId,
    exchangeRates,
    exchangeRateStaleAfterDays,
    feePlans,
    dataStatus,
  } = appData
  const defaultPlan =
    fixedPlans.find((plan) => plan.id === defaultProjectId) ?? fixedPlans[0]
  const comparisonDefaultPlan = fixedPlans[1] ?? defaultPlan
  const planA = useProjectConfiguration({
    defaultPlan,
    fixedPlans,
    enabledAssets,
    prefix: 'a',
  })
  const planB = useProjectConfiguration({
    defaultPlan: comparisonDefaultPlan,
    fixedPlans,
    enabledAssets,
    prefix: 'b',
  })

  const [principalWan, setPrincipalWan] = useState('100')
  const [years, setYears] = useState(4)
  const [planningOpen, setPlanningOpen] = useState(false)
  const [planningOptions, setPlanningOptions] = useState(initialPlanningOptions)
  const [calculation, setCalculation] = useState(null)
  const [calculationGenerated, setCalculationGenerated] = useState(false)
  const [basicResultDirty, setBasicResultDirty] = useState(false)
  const [generatedPlanning, setGeneratedPlanning] = useState(null)
  const [generatedPlanningYears, setGeneratedPlanningYears] = useState(years)
  const [planningGenerated, setPlanningGenerated] = useState(false)
  const [planningDirty, setPlanningDirty] = useState(false)
  const [
    generatedPlanningDependencyKey,
    setGeneratedPlanningDependencyKey,
  ] = useState(null)
  const [planningGenerationError, setPlanningGenerationError] = useState(null)
  const [comparisonEnabled, setComparisonEnabled] = useState(false)
  const [comparison, setComparison] = useState(null)
  const [planBCalculationError, setPlanBCalculationError] = useState(null)
  const [calculationError, setCalculationError] = useState(null)
  const planningResultRef = useRef(null)

  const usdRate = getPrimaryExchangeRate(exchangeRates, 'USD/TWD')
  const exchangeRateIsStale = isExchangeRateStale(
    usdRate,
    exchangeRateStaleAfterDays,
  )
  const exchangeFallbackMessage = exchangeFallbackHint(usdRate)

  const configurationNeedsUsdRate = (allocations) =>
    Object.keys(allocations).some(
      (assetId) => assetData[assetId]?.currency === 'USD',
    )
  const planAHasRequiredRates =
    !configurationNeedsUsdRate(planA.allocations) || Boolean(usdRate)
  const planBHasRequiredRates =
    !configurationNeedsUsdRate(planB.allocations) || Boolean(usdRate)
  const canCalculateA = planA.isAllocationValid && planAHasRequiredRates
  const planABasicSignature = createBasicComparisonSignature({
    principalWan,
    years,
    allocations: planA.allocations,
    usdRate,
  })
  const planBBasicSignature = createBasicComparisonSignature({
    principalWan,
    years,
    allocations: planB.allocations,
    usdRate,
  })
  const hasIdenticalComparison =
    comparisonEnabled && planABasicSignature === planBBasicSignature

  const annualLoanRate =
    planningOptions.loanRatePreset === 'custom'
      ? Number(planningOptions.customLoanRate) || 0
      : Number(planningOptions.loanRatePreset)
  const ownCapital = Math.max(Number(principalWan) || 0, 0) * 10000
  const sponsorCapital =
    Math.max(Number(planningOptions.sponsorCapitalWan) || 0, 0) * 10000
  const policyLoanTerms = resolvePolicyLoanTerms({
    capital: ownCapital,
    policyLoanRatio: planningOptions.policyLoanRatio,
    policyLoanAmount:
      Number(planningOptions.policyLoanAmountWan) * 10000,
    inputSource: planningOptions.policyLoanInputSource,
  })
  const planningDependencyKey = JSON.stringify({
    principalWan,
    years,
    selectedProjectId: planA.selectedProjectId,
    allocations: planA.allocations,
    comparisonEnabled,
    planBProjectId: planB.selectedProjectId,
    planBAllocations: planB.allocations,
    planningMode: planningOptions.planningMode,
    policyLoanRatio: planningOptions.policyLoanRatio,
    policyLoanAmountWan: planningOptions.policyLoanAmountWan,
    policyLoanInputSource: planningOptions.policyLoanInputSource,
    loanRatePreset: planningOptions.loanRatePreset,
    customLoanRate: planningOptions.customLoanRate,
    sponsorCapitalWan: planningOptions.sponsorCapitalWan,
    feeType: planningOptions.feeType,
    stressType: planningOptions.stressType,
  })
  const calculateBasicScenario = (allocations) => {
    const dividend = calculateDividendResult({
      principalWan,
      allocations,
      years,
      assetData,
      exchangeRates,
    })
    return {
      dividend,
      planning: null,
      stress: null,
      errors: [],
    }
  }

  const calculateCurrentPlanning = (allocations) =>
    calculatePlanningResult({
      planningMode: planningOptions.planningMode,
      principal: ownCapital,
      ownCapital,
      sponsorCapital,
      allocations,
      years,
      policyLoanRatio: planningOptions.policyLoanRatio,
      policyLoanAmount:
        Number(planningOptions.policyLoanAmountWan) * 10000,
      policyLoanInputSource: planningOptions.policyLoanInputSource,
      annualLoanRate,
      feeType: planningOptions.feeType,
      stressType: planningOptions.stressType,
      assetData,
      exchangeRates,
      feePlans,
    })

  const calculateLiveStress = (configuration) => {
    const principal = ownCapital
    let accumulatedDividend = 0
    let planning = null

    if (
      (!planningGenerated ||
        generatedPlanningDependencyKey !== planningDependencyKey)
    ) {
      return {
        enabled: planningOptions.stressType !== 'none',
        valid: false,
        scenario: planningOptions.stressType,
        error: '規劃條件已變更，請重新產生規劃。',
      }
    }

    if (
      planningOptions.planningMode === 'policyLoan' &&
      !policyLoanTerms.valid
    ) {
      return {
        enabled: true,
        valid: false,
        scenario: planningOptions.stressType,
        error:
          policyLoanTerms.error ===
          '保單借款不得超過投入本金的60%。'
            ? '保單借款超過60%，請修正後再產生規劃。'
            : policyLoanTerms.error,
      }
    }

    if (principal > 0 && configuration.isAllocationValid) {
      try {
        planning = calculateCurrentPlanning(configuration.allocations)
        accumulatedDividend = planning.cumulativeGrossDistribution
      } catch (error) {
        return {
          enabled: true,
          valid: false,
          scenario: planningOptions.stressType,
          error: `累積已領配息無法計算：${error.message}`,
        }
      }
    }

    return calculateStressTestResult({
      principal: planning?.policyInvestedCapital ?? principal,
      allocations: configuration.allocations,
      years,
      useLoan: (planning?.policyLoanPrincipal ?? 0) > 0,
      loanRatio: planning?.policyLoanRatio ?? 0,
      policyLoanPrincipal: planning?.policyLoanPrincipal ?? 0,
      planningMode: planning?.planningMode ?? 'none',
      ownCapital: planning?.ownCapital ?? principal,
      sponsorCapital: planning?.sponsorCapital ?? 0,
      annualLoanRate,
      feeType: planningOptions.feeType,
      stressType: planningOptions.stressType,
      assetData,
      exchangeRates,
      feePlans,
      accumulatedDividend,
    })
  }

  const stressResultA = useMemo(
    () => calculateLiveStress(planA),
    [
      principalWan,
      years,
      planA.allocations,
      planA.isAllocationValid,
      planningOptions.planningMode,
      planningOptions.policyLoanRatio,
      planningOptions.policyLoanAmountWan,
      planningOptions.policyLoanInputSource,
      planningOptions.sponsorCapitalWan,
      planningOptions.loanRatePreset,
      planningOptions.customLoanRate,
      planningOptions.feeType,
      planningOptions.stressType,
      annualLoanRate,
      assetData,
      exchangeRates,
      feePlans,
      planningGenerated,
      generatedPlanningDependencyKey,
      planningDependencyKey,
    ],
  )
  const stressResultB = useMemo(
    () => calculateLiveStress(planB),
    [
      principalWan,
      years,
      planB.allocations,
      planB.isAllocationValid,
      planningOptions.planningMode,
      planningOptions.policyLoanRatio,
      planningOptions.policyLoanAmountWan,
      planningOptions.policyLoanInputSource,
      planningOptions.sponsorCapitalWan,
      planningOptions.loanRatePreset,
      planningOptions.customLoanRate,
      planningOptions.feeType,
      planningOptions.stressType,
      annualLoanRate,
      assetData,
      exchangeRates,
      feePlans,
      planningGenerated,
      generatedPlanningDependencyKey,
      planningDependencyKey,
    ],
  )

  let planningValidationMessage = null
  if (!calculationGenerated || basicResultDirty) {
    planningValidationMessage = '請先完成基本配息計算。'
  } else if (!(ownCapital > 0)) {
    planningValidationMessage = '請先輸入大於 0 的投入本金。'
  } else if (!planA.isAllocationValid) {
    planningValidationMessage = '配置比例合計必須等於 100%。'
  } else if (!planAHasRequiredRates) {
    planningValidationMessage = '目前配置缺少必要匯率資料。'
  } else if (
    planningOptions.planningMode !== 'none' &&
    planningOptions.loanRatePreset === 'custom' &&
    (planningOptions.customLoanRate === '' ||
      !Number.isFinite(Number(planningOptions.customLoanRate)) ||
      Number(planningOptions.customLoanRate) < 0)
  ) {
    planningValidationMessage = '請輸入有效的保單貸款利率。'
  } else if (
    planningOptions.planningMode === 'policyLoan' &&
    (planningOptions.policyLoanRatio === '' ||
      planningOptions.policyLoanAmountWan === '')
  ) {
    planningValidationMessage = '請輸入保單貸款比例或借款金額。'
  } else if (
    planningOptions.planningMode === 'policyLoan' &&
    !policyLoanTerms.valid
  ) {
    planningValidationMessage = policyLoanTerms.error
  } else if (
    planningOptions.planningMode === 'sponsorProject' &&
    !(sponsorCapital > 0)
  ) {
    planningValidationMessage = '請輸入大於 0 的金主借款金額。'
  }
  const canGeneratePlanning = planningValidationMessage === null
  const policyLoanError =
    planningOptions.planningMode === 'policyLoan' &&
    !policyLoanTerms.valid
      ? policyLoanTerms.error
      : null
  const previousPlanningDependency = useRef(planningDependencyKey)

  useEffect(() => {
    if (previousPlanningDependency.current !== planningDependencyKey) {
      if (planningGenerated) setPlanningDirty(true)
      previousPlanningDependency.current = planningDependencyKey
    }
  }, [planningDependencyKey, planningGenerated])

  const calculationDependencyKey = JSON.stringify({
    principalWan,
    years,
    planAProjectId: planA.selectedProjectId,
    planAAllocations: planA.allocations,
    planBProjectId: planB.selectedProjectId,
    planBAllocations: planB.allocations,
    comparisonEnabled,
    usdRate: usdRate
      ? {
          spotBuyingRate: usdRate.spotBuyingRate,
          spotSellingRate: usdRate.spotSellingRate,
          rateDate: usdRate.rateDate,
        }
      : null,
  })
  const previousCalculationDependency = useRef(calculationDependencyKey)

  useEffect(() => {
    if (
      previousCalculationDependency.current !== calculationDependencyKey
    ) {
      if (calculationGenerated) setBasicResultDirty(true)
      setPlanBCalculationError(null)
      previousCalculationDependency.current = calculationDependencyKey
    }
  }, [calculationDependencyKey, calculationGenerated])

  const handlePrincipalChange = (value) => {
    const nextPrincipal = Number(value)
    setPrincipalWan(value)
    setPlanningOptions((current) => {
      if (current.policyLoanInputSource === 'amount') {
        const currentAmount = Number(current.policyLoanAmountWan)
        const nextRatio =
          nextPrincipal > 0 && Number.isFinite(currentAmount)
            ? (currentAmount / nextPrincipal) * 100
            : ''
        return {
          ...current,
          policyLoanRatio:
            nextRatio === '' ? '' : formatLinkedInput(nextRatio),
        }
      }
      const currentRatio = Number(current.policyLoanRatio)
      const nextAmount =
        nextPrincipal > 0 && Number.isFinite(currentRatio)
          ? (nextPrincipal * currentRatio) / 100
          : ''
      return {
        ...current,
        policyLoanAmountWan:
          nextAmount === '' ? '' : formatLinkedInput(nextAmount),
      }
    })
  }

  const getConfigurationError = (configuration, hasRequiredRates, label) => {
    if (!(ownCapital > 0)) return '請先輸入大於 0 的投入本金。'
    if (!configuration.isAllocationValid) {
      return `${label}配置比例合計必須等於 100%。`
    }
    if (!hasRequiredRates) return `${label}目前配置缺少必要匯率資料。`
    return null
  }

  const handleCalculate = () => {
    const planAError = getConfigurationError(
      planA,
      planAHasRequiredRates,
      '方案 A',
    )
    const planBError = comparisonEnabled
      ? getConfigurationError(planB, planBHasRequiredRates, '方案 B')
      : null

    setPlanBCalculationError(planBError)
    if (planAError || planBError) {
      setCalculationError(planAError)
      if (calculationGenerated) setBasicResultDirty(true)
      return
    }

    let nextCalculation
    let nextComparison = null
    try {
      nextCalculation = calculateBasicScenario(planA.allocations)
    } catch (error) {
      setCalculationError(`方案 A：${error.message}`)
      if (calculationGenerated) setBasicResultDirty(true)
      return
    }

    if (comparisonEnabled) {
      try {
        const planBResult = calculateBasicScenario(planB.allocations)
        nextComparison = { a: nextCalculation, b: planBResult }
      } catch (error) {
        setPlanBCalculationError(`方案 B：${error.message}`)
        setCalculationError(null)
        if (calculationGenerated) setBasicResultDirty(true)
        return
      }
    }

    setCalculation(nextCalculation)
    setComparison(nextComparison)
    setCalculationError(null)
    setPlanBCalculationError(null)
    setCalculationGenerated(true)
    setBasicResultDirty(false)
  }

  const handleGeneratePlanning = () => {
    setPlanningGenerationError(null)
    if (!canGeneratePlanning) return
    try {
      const nextPlanning = calculateCurrentPlanning(planA.allocations)
      setGeneratedPlanning(nextPlanning)
      setGeneratedPlanningYears(years)
      setPlanningGenerated(true)
      setPlanningDirty(false)
      setGeneratedPlanningDependencyKey(planningDependencyKey)
      window.setTimeout(() => {
        planningResultRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }, 0)
    } catch (error) {
      setPlanningGenerationError(error.message)
    }
  }

  const projectName = (configuration) =>
    configuration.selectedProjectId === CUSTOM_PROJECT_ID
      ? '自訂專案'
      : fixedPlans.find(
          (plan) => plan.id === configuration.selectedProjectId,
        )?.name ?? '未命名專案'
  const basicResult = calculation?.dividend ?? null
  const comparisonResultA = comparison?.a?.dividend ?? null
  const comparisonResultB = comparison?.b?.dividend ?? null
  const hasCompleteComparison =
    comparisonResultA !== null && comparisonResultB !== null

  return (
    <main className="content">
      <SectionCard
        eyebrow="START HERE"
        title="基本資料"
        description="本金、期間、匯率與規劃條件由方案 A、B 共用。"
      >
        <div className="form-grid shared-inputs">
          <Field label="投入本金" hint="以萬元計">
            <div className="input-with-unit">
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={principalWan}
                onChange={(event) =>
                  handlePrincipalChange(event.target.value)
                }
                aria-label="投入本金，單位萬元"
              />
              <span>萬元</span>
            </div>
          </Field>

          <Field label="試算期間">
            <div className="period-control">
              <select
                value={years}
                onChange={(event) => setYears(Number(event.target.value))}
              >
                <option value={4}>4 年</option>
                <option value={7}>7 年</option>
                <option value={10}>10 年</option>
              </select>
            </div>
          </Field>
        </div>

        <div
          className={`exchange-info ${
            !usdRate || exchangeRateIsStale ? 'has-warning' : ''
          }`}
        >
          {usdRate ? (
            <>
              <div>
                <span>匯率來源</span>
                <strong>{usdRate.sourceName}</strong>
              </div>
              <div>
                <span>匯率日期</span>
                <strong>{formatDate(usdRate.rateDate)}</strong>
              </div>
              {exchangeRateIsStale && (
                <p>匯率資料已超過 {exchangeRateStaleAfterDays} 天，請更新後再確認試算結果。</p>
              )}
              {exchangeFallbackMessage && <p>{exchangeFallbackMessage}</p>}
            </>
          ) : (
            <p>找不到 USD/TWD 即期匯率，含美元標的的方案無法計算。</p>
          )}
        </div>

      </SectionCard>

      <SectionCard
        eyebrow="ALLOCATION"
        title="方案 A 標的配置"
        description="選擇專案並確認實際投入比例與最新淨值。"
      >
        <ProjectConfigurator
          label="方案 A"
          {...planA}
          fixedPlans={fixedPlans}
          customProjectId={CUSTOM_PROJECT_ID}
          assetData={assetData}
          enabledAssets={enabledAssets}
          onProjectChange={planA.changeProject}
          onAssetChange={planA.changeAsset}
          onPercentageChange={planA.changePercentage}
          onAddAsset={planA.addAsset}
          onRemoveAsset={planA.removeAsset}
        />
      </SectionCard>

      {comparisonEnabled && (
        <SectionCard
          eyebrow="COMPARE"
          title="方案 B 標的配置"
          description="方案 B 使用共用本金、期間與規劃條件，標的配置獨立設定。"
        >
          <ProjectConfigurator
            label="方案 B"
            {...planB}
            fixedPlans={fixedPlans}
            customProjectId={CUSTOM_PROJECT_ID}
            assetData={assetData}
            enabledAssets={enabledAssets}
            onProjectChange={planB.changeProject}
            onAssetChange={planB.changeAsset}
            onPercentageChange={planB.changePercentage}
            onAddAsset={planB.addAsset}
            onRemoveAsset={planB.removeAsset}
          />
          {planBCalculationError && (
            <div className="comparison-validation-error" role="alert">
              <strong>方案 B 尚未完成</strong>
              <span>{planBCalculationError}</span>
            </div>
          )}
        </SectionCard>
      )}

      <div className="primary-action-stack">
        {comparisonEnabled ? (
          <button
            type="button"
            className="remove-comparison-button comparison-toggle-button"
            onClick={() => {
              setComparisonEnabled(false)
              setComparison(null)
              setPlanBCalculationError(null)
              setCalculationError(null)
            }}
          >
            取消比較
          </button>
        ) : (
          <button
            type="button"
            className="add-comparison"
            onClick={() => setComparisonEnabled(true)}
          >
            ＋ 加入比較
          </button>
        )}
        <button
          className="calculate-button"
          onClick={handleCalculate}
          disabled={!canCalculateA || hasIdenticalComparison}
        >
          <span>開始計算配息</span>
          <span aria-hidden="true">→</span>
        </button>
        {hasIdenticalComparison && (
          <p className="identical-comparison-warning" role="status">
            方案A與方案B內容相同，請調整其中一個方案後再比較。
          </p>
        )}
      </div>

      {calculationError && (
        <div className="data-error" role="alert">
          <strong>資料無法計算</strong>
          <span>{calculationError}</span>
        </div>
      )}

      {calculationGenerated &&
      !basicResultDirty &&
      comparisonEnabled &&
      hasCompleteComparison ? (
        <>
          <section className="comparison-basic-results">
            <div className="section-heading">
              <span className="eyebrow">ESTIMATE</span>
              <h2>基本配息結果</h2>
              <p>方案 A、B 分別依各自實際標的配置估算。</p>
            </div>
            <div className="dual-basic-results">
              <ResultCard
                result={comparisonResultA}
                years={years}
                eyebrow="方案 A"
                title={`方案 A｜${projectName(planA)}`}
                className="comparison-basic-result-card"
              />
              <ResultCard
                result={comparisonResultB}
                years={years}
                eyebrow="方案 B"
                title={`方案 B｜${projectName(planB)}`}
                className="comparison-basic-result-card"
              />
            </div>
          </section>
          <ComparisonResultCard
            comparison={comparison}
            years={years}
            planAName={projectName(planA)}
            planBName={projectName(planB)}
          />
        </>
      ) : calculationGenerated &&
        !basicResultDirty &&
        !comparisonEnabled &&
        basicResult ? (
        <ResultCard result={basicResult} years={years} />
      ) : (
        <div className="empty-result">
          <span>
            {basicResultDirty
              ? '計算條件已變更'
              : '試算結果會顯示在這裡'}
          </span>
          <p>
            {basicResultDirty
              ? '請重新按下「開始計算配息」，更新所有結果。'
              : '確認資料與配置後，按下「開始計算配息」。'}
          </p>
        </div>
      )}

      <section className={`planning-card ${planningOpen ? 'is-open' : ''}`}>
        <button
          className="planning-toggle"
          onClick={() => setPlanningOpen((open) => !open)}
          aria-expanded={planningOpen}
        >
          <span className="plus-icon" aria-hidden="true">
            {planningOpen ? '−' : '+'}
          </span>
          <span>{planningOpen ? '收合規劃條件' : '增加規劃條件'}</span>
          <span className="toggle-hint">資金模式、商品費用與壓力測試</span>
        </button>
        {planningOpen && (
          <PlanningOptions
            options={planningOptions}
            onChange={setPlanningOptions}
            feePlans={feePlans}
            principalWan={principalWan}
            showSponsorProjectHint={['sponsor1', 'sponsor2'].includes(
              planA.selectedProjectId,
            )}
            policyLoanError={policyLoanError}
            generateDisabled={!canGeneratePlanning}
            generateMessage={
              planningGenerationError ??
              planningValidationMessage ??
              (planningGenerated && planningDirty
                ? '規劃條件已變更，請重新產生規劃。'
                : null)
            }
            onGenerate={handleGeneratePlanning}
          />
        )}
      </section>

      <div className="data-footnote">
        <span>{dataStatus}</span>
        <p>資料依來源日期顯示；使用上次資料或備援資料時會另行提示。</p>
      </div>

      {planningGenerated && generatedPlanning && (
        <div ref={planningResultRef}>
          <PlanningResultCard
            result={generatedPlanning}
            years={generatedPlanningYears}
            dirty={planningDirty}
          />
        </div>
      )}

      <StressTestResult
        result={stressResultA}
        comparisonEnabled={comparisonEnabled}
        comparisonResultA={stressResultA}
        comparisonResultB={stressResultB}
      />
    </main>
  )
}

function App() {
  const [appData, setAppData] = useState(null)
  const [dataError, setDataError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadAppData()
      .then((data) => {
        if (!cancelled) setAppData(data)
      })
      .catch((error) => {
        if (!cancelled) setDataError(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app-shell">
      <SiteHeader />
      {dataError && (
        <main className="content">
          <div className="data-load-state is-error" role="alert">
            <strong>資料讀取錯誤</strong>
            <p>{dataError}</p>
            <span>請重新匯入並更新資料後再載入頁面。</span>
          </div>
        </main>
      )}
      {!appData && !dataError && (
        <main className="content">
          <div className="data-load-state">
            <strong>正在讀取試算資料</strong>
            <p>請稍候。</p>
          </div>
        </main>
      )}
      {appData && <CalculatorApp appData={appData} />}
      <footer>
        <p>Excel 資料設定 · 淨值、配息與匯率分項更新</p>
      </footer>
    </div>
  )
}

export default App
