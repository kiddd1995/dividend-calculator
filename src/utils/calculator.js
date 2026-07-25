function getCurrencyRate(currency, exchangeRates) {
  if (currency === 'TWD') return null
  const pair = `${currency}/TWD`
  const rate = [...exchangeRates]
    .filter((item) => item.currencyPair === pair)
    .sort((a, b) => a.priority - b.priority)[0]

  if (!rate?.spotBuyingRate || !rate?.spotSellingRate) {
    throw new Error(`${pair} 缺少有效的即期匯率資料`)
  }
  return rate
}

function twdToAssetCurrency(amountTwd, currency, exchangeRates) {
  if (currency === 'TWD') return amountTwd
  const rate = getCurrencyRate(currency, exchangeRates)
  return amountTwd / rate.spotSellingRate
}

function assetCurrencyToTwd(amount, currency, exchangeRates) {
  if (currency === 'TWD') return amount
  const rate = getCurrencyRate(currency, exchangeRates)
  return amount * rate.spotBuyingRate
}

export function calculateDividendResult({
  principalWan,
  allocations,
  years,
  assetData,
  exchangeRates,
}) {
  const principal = Math.max(Number(principalWan) || 0, 0) * 10000

  const monthlyDividend = Object.entries(allocations).reduce(
    (total, [assetId, percentage]) => {
      const asset = assetData[assetId]
      if (!asset) throw new Error(`找不到標的資料：${assetId}`)
      if (!(asset.nav > 0) || !(asset.distributionPerUnit >= 0)) {
        throw new Error(`${asset.displayName} 的淨值或配息資料無效`)
      }

      const allocatedTwd = principal * (percentage / 100)
      const allocatedInAssetCurrency = twdToAssetCurrency(
        allocatedTwd,
        asset.currency,
        exchangeRates,
      )
      const estimatedUnits = allocatedInAssetCurrency / asset.nav
      const distributionInAssetCurrency =
        estimatedUnits * asset.distributionPerUnit

      return (
        total +
        assetCurrencyToTwd(
          distributionInAssetCurrency,
          asset.currency,
          exchangeRates,
        )
      )
    },
    0,
  )

  const annualDividend = monthlyDividend * 12

  return {
    principal,
    monthlyDividend,
    annualDividend,
    accumulatedDividend: annualDividend * years,
    annualizedDistributionRate:
      principal > 0 ? (annualDividend / principal) * 100 : 0,
  }
}

function calculateProductFees(principal, feeType, years, feePlans) {
  if (feeType === 'none') return 0
  const feePlan = feePlans.find((plan) => plan.id === feeType)
  if (!feePlan) throw new Error(`找不到商品費用方案：${feeType}`)

  const monthsToCalculate = years * 12
  return feePlan.periods.reduce((total, period) => {
    const lastMonth = Math.min(period.toMonth, monthsToCalculate)
    const applicableMonths = Math.max(lastMonth - period.fromMonth + 1, 0)
    return total + principal * period.monthlyFeeRate * applicableMonths
  }, 0)
}

function getMarketScenarioDrawdown(asset) {
  if (
    asset.marketScenarioDrawdown === null ||
    asset.marketScenarioDrawdown === undefined ||
    asset.marketScenarioDrawdown === ''
  ) {
    return null
  }
  const scenario = Number(asset.marketScenarioDrawdown)
  return Number.isFinite(scenario) && scenario >= -1 ? scenario : null
}

export function resolvePolicyLoanTerms({
  capital,
  policyLoanRatio,
  policyLoanAmount,
  inputSource = 'ratio',
}) {
  const numericCapital = Number(capital)
  if (!(numericCapital > 0)) {
    return {
      valid: false,
      error: '請先輸入大於 0 的投入本金。',
      policyLoanRatio: null,
      policyLoanAmount: null,
    }
  }

  const usesAmount = inputSource === 'amount'
  const sourceValue = usesAmount
    ? Number(policyLoanAmount)
    : Number(policyLoanRatio)
  if (!Number.isFinite(sourceValue) || sourceValue < 0) {
    return {
      valid: false,
      error: usesAmount
        ? '請輸入有效的保單借款金額。'
        : '請輸入有效的保單貸款比例。',
      policyLoanRatio: null,
      policyLoanAmount: null,
    }
  }

  const resolvedAmount = usesAmount
    ? sourceValue
    : numericCapital * (sourceValue / 100)
  const resolvedRatio = usesAmount
    ? (resolvedAmount / numericCapital) * 100
    : sourceValue
  const exceedsLimit =
    resolvedRatio > 60 || resolvedAmount > numericCapital * 0.6

  return {
    valid: !exceedsLimit,
    error: exceedsLimit
      ? '保單借款不得超過投入本金的60%。'
      : null,
    policyLoanRatio: resolvedRatio,
    policyLoanAmount: resolvedAmount,
  }
}

function getFeeSource(allocations) {
  const assetIds = Object.keys(allocations)
  const qqqId = assetIds.find((assetId) => assetId.toLowerCase() === 'qqq')
  if (qqqId) return qqqId
  const allianzTaiwanTechId = assetIds.find(
    (assetId) => assetId.toLowerCase() === 'allianztaiwantech',
  )
  if (allianzTaiwanTechId) return allianzTaiwanTechId
  return Object.keys(allocations)[0] ?? null
}

function getExtremeAssetDrawdown(asset) {
  const configuredValue = asset.extremeStressDrawdown
  if (!Number.isFinite(configuredValue)) return null
  const signedDrawdown =
    configuredValue > 0 ? -configuredValue : configuredValue
  return signedDrawdown >= -1 && signedDrawdown <= 0
    ? signedDrawdown
    : null
}

function getSafetyStatus(useLoan, stressedLoanRatio, stressedAccountValue) {
  if (!useLoan) return '未使用'
  if (!(stressedAccountValue > 0) || !Number.isFinite(stressedLoanRatio)) {
    return '極端風險'
  }
  if (stressedLoanRatio < 70) return '相對安全'
  if (stressedLoanRatio < 80) return '注意'
  if (stressedLoanRatio < 85) return '高風險'
  return '達警戒線'
}

export function calculateStressTestResult({
  principal,
  allocations,
  years,
  useLoan,
  loanRatio,
  policyLoanPrincipal,
  planningMode = 'none',
  ownCapital = 0,
  sponsorCapital = 0,
  annualLoanRate,
  feeType,
  stressType,
  assetData,
  exchangeRates,
  feePlans,
  accumulatedDividend,
}) {
  if (stressType === 'none') {
    return {
      enabled: false,
      valid: true,
      scenario: 'none',
      scenarioLabel: '未啟用',
    }
  }

  const numericPrincipal = Number(principal)
  const allocationTotal = Object.values(allocations).reduce(
    (sum, percentage) => sum + (Number(percentage) || 0),
    0,
  )
  if (!(numericPrincipal > 0)) {
    return {
      enabled: true,
      valid: false,
      scenario: stressType,
      error: '請先輸入大於 0 的投入本金。',
    }
  }
  if (Math.abs(allocationTotal - 100) > 0.0001) {
    return {
      enabled: true,
      valid: false,
      scenario: stressType,
      error: '配置比例合計必須等於 100%，才能計算壓力測試。',
    }
  }

  let assetDetails
  let totalProductFees
  let marketStressedValue
  let marketWeightedDrawdownPercentage
  let finalStressedAccountValue
  let totalReceivedDividend
  const monthlyProjection = null

  if (stressType === 'normal') {
    const missingAssets = []
    assetDetails = Object.entries(allocations).map(
      ([assetId, percentage]) => {
        const asset = assetData[assetId]
        if (!asset) {
          missingAssets.push(assetId)
          return null
        }
        const drawdown = getMarketScenarioDrawdown(asset)
        if (drawdown === null) {
          missingAssets.push(asset.displayName || assetId)
          return null
        }
        const allocationPercentage = Number(percentage) || 0
        const originalAmount =
          numericPrincipal * (allocationPercentage / 100)
        return {
          assetId,
          displayName: asset.displayName,
          allocationPercentage,
          originalAmount,
          marketScenarioDrawdown: drawdown,
          stressedValue: originalAmount * (1 + drawdown),
        }
      },
    )

    if (missingAssets.length > 0) {
      return {
        enabled: true,
        valid: false,
        scenario: stressType,
        error: `以下標的缺少一般市場試算設定：${missingAssets.join('、')}`,
        missingAssets,
      }
    }

    totalProductFees = calculateProductFees(
      numericPrincipal,
      feeType,
      years,
      feePlans,
    )
    marketStressedValue = assetDetails.reduce(
      (sum, detail) => sum + detail.stressedValue,
      0,
    )
    marketWeightedDrawdownPercentage = assetDetails.reduce(
      (sum, detail) =>
        sum +
        detail.allocationPercentage * detail.marketScenarioDrawdown,
      0,
    )
    finalStressedAccountValue = marketStressedValue - totalProductFees
    totalReceivedDividend = Number(accumulatedDividend) || 0
  } else {
    const missingAssets = []
    assetDetails = Object.entries(allocations).map(
      ([assetId, percentage]) => {
        const asset = assetData[assetId]
        if (!asset) {
          missingAssets.push(assetId)
          return null
        }
        const drawdown = getExtremeAssetDrawdown(asset)
        if (drawdown === null) {
          missingAssets.push(asset.displayName || assetId)
          return null
        }
        const allocationPercentage = Number(percentage) || 0
        const originalAmount =
          numericPrincipal * (allocationPercentage / 100)
        return {
          assetId,
          displayName: asset.displayName,
          allocationPercentage,
          originalAmount,
          drawdown,
          stressedValue: originalAmount * (1 + drawdown),
        }
      },
    )

    if (missingAssets.length > 0) {
      return {
        enabled: true,
        valid: false,
        scenario: stressType,
        error: `以下標的缺少極端壓力跌幅設定：${missingAssets.join('、')}`,
        missingAssets,
      }
    }

    totalProductFees = calculateProductFees(
      numericPrincipal,
      feeType,
      years,
      feePlans,
    )
    marketStressedValue = assetDetails.reduce(
      (sum, detail) => sum + detail.stressedValue,
      0,
    )
    marketWeightedDrawdownPercentage = assetDetails.reduce(
      (sum, detail) =>
        sum + detail.allocationPercentage * Math.abs(detail.drawdown),
      0,
    )
    finalStressedAccountValue = marketStressedValue - totalProductFees
    totalReceivedDividend = Number(accumulatedDividend) || 0
  }

  const accountValueDecrease =
    numericPrincipal - finalStressedAccountValue
  const accountValueDrawdownPercentage =
    (accountValueDecrease / numericPrincipal) * 100
  const observedTotalAssets =
    finalStressedAccountValue + totalReceivedDividend
  const hasExactLoanPrincipal = Number.isFinite(Number(policyLoanPrincipal))
  const loanPrincipal = useLoan
    ? hasExactLoanPrincipal
      ? Math.max(Number(policyLoanPrincipal), 0)
      : numericPrincipal * ((Number(loanRatio) || 0) / 100)
    : 0
  const stressedLoanRatio =
    useLoan && finalStressedAccountValue > 0
      ? (loanPrincipal / finalStressedAccountValue) * 100
      : useLoan
        ? null
        : null
  const safeAccountValue = useLoan ? loanPrincipal / 0.85 : null
  const safetyValueGap =
    useLoan && Number.isFinite(finalStressedAccountValue)
      ? finalStressedAccountValue - safeAccountValue
      : null
  const requiredTopUp =
    useLoan && Number.isFinite(safetyValueGap)
      ? Math.max(0, -safetyValueGap)
      : null
  const warningLineGap =
    useLoan && stressedLoanRatio !== null ? 85 - stressedLoanRatio : null

  return {
    enabled: true,
    valid: true,
    scenario: stressType,
    scenarioLabel:
      stressType === 'normal' ? '一般市場試算' : '極端壓力測試',
    principal: numericPrincipal,
    totalProductFees,
    marketStressedValue,
    marketWeightedDrawdownPercentage,
    monthlyProjection,
    finalStressedAccountValue,
    // 保留舊欄位，避免既有規劃與比較介面在過渡期間失效。
    stressedValueBeforeFees: marketStressedValue,
    stressedAccountValue: finalStressedAccountValue,
    accountValueDecrease,
    accountValueDrawdownPercentage,
    accumulatedDividend: totalReceivedDividend,
    observedTotalAssets,
    assetDetails,
    useLoan,
    planningMode,
    ownCapital: Math.max(Number(ownCapital) || 0, 0),
    sponsorCapital: Math.max(Number(sponsorCapital) || 0, 0),
    loanPrincipal,
    annualLoanRate: Number(annualLoanRate) || 0,
    stressedLoanRatio,
    warningLineGap,
    safeAccountValue,
    safetyValueGap,
    requiredTopUp,
    // 保留舊欄位名稱供既有使用端相容；數值與 85% 安全帳戶價值相同。
    warningAccountValue: safeAccountValue,
    safetyStatus: getSafetyStatus(
      useLoan,
      stressedLoanRatio,
      finalStressedAccountValue,
    ),
    belowWarningAccountValue:
      useLoan && Number.isFinite(safetyValueGap) && safetyValueGap < 0,
    riskSnapshot: {
      feeSource: getFeeSource(allocations),
    },
  }
}

export function calculatePlanningResult({
  planningMode = 'none',
  principal,
  ownCapital = principal,
  sponsorCapital = 0,
  allocations,
  years,
  loanRatio,
  policyLoanRatio = loanRatio,
  policyLoanAmount,
  policyLoanInputSource = 'ratio',
  annualLoanRate,
  feeType,
  stressType,
  assetData,
  exchangeRates,
  feePlans,
}) {
  const supportedModes = ['none', 'policyLoan', 'sponsorProject']
  const normalizedPlanningMode = supportedModes.includes(planningMode)
    ? planningMode
    : 'none'
  const numericOwnCapital = Math.max(Number(ownCapital) || 0, 0)
  const numericSponsorCapital =
    normalizedPlanningMode === 'sponsorProject'
      ? Math.max(Number(sponsorCapital) || 0, 0)
      : 0
  const policyInvestedCapital =
    normalizedPlanningMode === 'sponsorProject'
      ? numericOwnCapital + numericSponsorCapital
      : numericOwnCapital
  const policyLoanTerms =
    normalizedPlanningMode === 'policyLoan'
      ? resolvePolicyLoanTerms({
          capital: numericOwnCapital,
          policyLoanRatio,
          policyLoanAmount,
          inputSource: policyLoanInputSource,
        })
      : null
  if (policyLoanTerms && !policyLoanTerms.valid) {
    throw new Error(policyLoanTerms.error)
  }
  const resolvedPolicyLoanRatio =
    policyLoanTerms?.policyLoanRatio ??
    (policyInvestedCapital > 0
      ? (numericSponsorCapital / policyInvestedCapital) * 100
      : 0)
  const policyLoanPrincipal =
    normalizedPlanningMode === 'policyLoan'
      ? policyLoanTerms.policyLoanAmount
      : normalizedPlanningMode === 'sponsorProject'
        ? numericSponsorCapital
        : 0
  const useLoan = policyLoanPrincipal > 0
  const plannedDividend = calculateDividendResult({
    principalWan: policyInvestedCapital / 10000,
    allocations,
    years,
    assetData,
    exchangeRates,
  })
  const monthlyGrossDistribution = plannedDividend.monthlyDividend
  const annualGrossDistribution = plannedDividend.annualDividend
  const cumulativeGrossDistribution = plannedDividend.accumulatedDividend
  const annualLoanInterest =
    policyLoanPrincipal * ((Number(annualLoanRate) || 0) / 100)
  const deductInterestFromDistribution =
    normalizedPlanningMode === 'sponsorProject'
  const monthlyInterestReserve = deductInterestFromDistribution
    ? annualLoanInterest / 12
    : null
  const cumulativeLoanInterest = annualLoanInterest * years
  const monthlyNetDistribution = deductInterestFromDistribution
    ? monthlyGrossDistribution - monthlyInterestReserve
    : null
  const annualNetDistribution = deductInterestFromDistribution
    ? annualGrossDistribution - annualLoanInterest
    : null
  const cumulativeNetDistribution = deductInterestFromDistribution
    ? cumulativeGrossDistribution - cumulativeLoanInterest
    : null
  const grossDistributionRate =
    policyInvestedCapital > 0
      ? (annualGrossDistribution / policyInvestedCapital) * 100
      : 0
  const netCashflowRateOnOwnCapital =
    deductInterestFromDistribution && numericOwnCapital > 0
      ? (annualNetDistribution / numericOwnCapital) * 100
      : null
  const initialAccountLoanRatio =
    policyInvestedCapital > 0
      ? (policyLoanPrincipal / policyInvestedCapital) * 100
      : 0
  const totalProductFees = calculateProductFees(
    policyInvestedCapital,
    feeType,
    years,
    feePlans,
  )
  const feePlanName =
    feePlans.find((feePlan) => feePlan.id === feeType)?.name ?? feeType
  const projectedAccountValue = policyInvestedCapital - totalProductFees
  const stressResult = calculateStressTestResult({
    principal: policyInvestedCapital,
    allocations,
    years,
    useLoan,
    loanRatio: resolvedPolicyLoanRatio,
    policyLoanPrincipal,
    policyLoanRatio: resolvedPolicyLoanRatio,
    policyLoanAmount: policyLoanPrincipal,
    planningMode: normalizedPlanningMode,
    ownCapital: numericOwnCapital,
    sponsorCapital: numericSponsorCapital,
    annualLoanRate,
    feeType,
    stressType,
    assetData,
    exchangeRates,
    feePlans,
    accumulatedDividend: 0,
  })
  const stressedAssetValue =
    stressResult.enabled && stressResult.valid
      ? stressResult.stressedAccountValue
      : null
  const highestLoanRatio = useLoan
    ? stressedAssetValue !== null && stressedAssetValue > 0
      ? (policyLoanPrincipal / stressedAssetValue) * 100
      : initialAccountLoanRatio
    : 0

  return {
    planningMode: normalizedPlanningMode,
    ownCapital: numericOwnCapital,
    sponsorCapital: numericSponsorCapital,
    policyInvestedCapital,
    policyLoanPrincipal,
    policyLoanRatio: resolvedPolicyLoanRatio,
    policyLoanAmount: policyLoanPrincipal,
    loanInterestRate: Number(annualLoanRate) || 0,
    monthlyGrossDistribution,
    annualGrossDistribution,
    monthlyInterestReserve,
    annualLoanInterest,
    monthlyNetDistribution,
    annualNetDistribution,
    cumulativeGrossDistribution,
    cumulativeLoanInterest,
    cumulativeNetDistribution,
    grossDistributionRate,
    netCashflowRateOnOwnCapital,
    initialAccountLoanRatio,
    feePlanId: feeType,
    feePlanName,
    totalProductFees,
    projectedAccountValue,
    loanAmount: policyLoanPrincipal,
    stressedAssetValue,
    highestLoanRatio,
    // 商品費用不從配息扣除；以下欄位只保留給後台風險模型使用。
    riskSnapshot: {
      feeSource: getFeeSource(allocations),
      totalProductFees,
      stressedAssetValue,
      stressedLoanToValue: highestLoanRatio,
      reachesWarningLine: highestLoanRatio >= 85,
    },
  }
}
