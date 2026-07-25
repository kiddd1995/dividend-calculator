import fs from 'node:fs/promises'
import {
  calculateDividendResult,
  calculatePlanningResult,
  calculateStressTestResult,
  resolvePolicyLoanTerms,
} from '../src/utils/calculator.js'

const [assetsPayload, plansPayload, exchangePayload, feePayload] =
  await Promise.all([
    fs.readFile('public/data/assets-live.json', 'utf8').then(JSON.parse),
    fs.readFile('public/data/plans.json', 'utf8').then(JSON.parse),
    fs.readFile('public/data/exchange-live.json', 'utf8').then(JSON.parse),
    fs.readFile('public/data/fee-plans.json', 'utf8').then(JSON.parse),
  ])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const assetData = Object.fromEntries(
  assetsPayload.assets.map((asset) => [asset.assetId, asset]),
)
for (const asset of assetsPayload.assets) {
  assert(
    Number.isFinite(asset.marketScenarioDrawdown),
    `${asset.displayName} 應有一般市場試算情境百分比`,
  )
}
const qqq = assetData.qqq
assert(qqq?.navStatus === 'success', 'QQQ 淨值應為成功')
assert(qqq?.distributionStatus === 'manual', 'QQQ 配息應為 manual')
assert(qqq?.distributionPerUnit === 0, 'QQQ 每單位配息應為 0')
assert(qqq?.annualDistributionRate === 0, 'QQQ 年化配息率應為 0')
assert(!qqq?.distributionFailureReason, 'QQQ 不應有配息錯誤')

const qqqPlan = plansPayload.plans.find((plan) => plan.id === 'stable2')
assert(qqqPlan?.allocations.qqq === 20, '測試專案應包含 QQQ 20%')

const dividend = calculateDividendResult({
  principalWan: 100,
  allocations: qqqPlan.allocations,
  years: 4,
  assetData,
  exchangeRates: exchangePayload.rates,
})
assert(Number.isFinite(dividend.monthlyDividend), '含 QQQ 的配息試算應可完成')

const planning = calculatePlanningResult({
  planningMode: 'policyLoan',
  principal: dividend.principal,
  ownCapital: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  policyLoanRatio: 40,
  policyLoanAmount: 400000,
  policyLoanInputSource: 'ratio',
  annualLoanRate: 3.85,
  feeType: 'fourYear',
  stressType: 'normal',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
})
assert(planning.riskSnapshot.feeSource === 'qqq', '含 QQQ 時應優先由 QQQ 扣費')
assert(planning.stressedAssetValue > 0, 'QQQ 應計入壓力後帳戶價值')
assert(planning.highestLoanRatio > 0, 'QQQ 應計入貸款比率風險計算')

const noPlanning = calculatePlanningResult({
  principal: dividend.principal,
  ownCapital: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  loanRatio: 40,
  annualLoanRate: 4,
  feeType: 'none',
  stressType: 'none',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
})
assert(noPlanning.planningMode === 'none', '舊資料缺少規劃模式時應預設為 none')
assert(
  Math.abs(noPlanning.annualGrossDistribution - dividend.annualDividend) <
    0.001,
  '無資金規劃的毛配息應與基本配息完全一致',
)

const noLoanFeePlanning = calculatePlanningResult({
  planningMode: 'none',
  principal: dividend.principal,
  ownCapital: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  annualLoanRate: 4,
  feeType: 'fourYear',
  stressType: 'normal',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
})
const sevenYearFeePlanning = calculatePlanningResult({
  planningMode: 'none',
  principal: dividend.principal,
  ownCapital: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 7,
  annualLoanRate: 4,
  feeType: 'fourYear',
  stressType: 'none',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
})
assert(
  noLoanFeePlanning.policyInvestedCapital === 1000000 &&
    noLoanFeePlanning.policyLoanPrincipal === 0 &&
    noLoanFeePlanning.annualLoanInterest === 0 &&
    noLoanFeePlanning.initialAccountLoanRatio === 0,
  '無貸款規劃應以本金投入且所有貸款數值為 0',
)
assert(
  Math.abs(noLoanFeePlanning.totalProductFees - 72000) < 0.001 &&
    Math.abs(noLoanFeePlanning.projectedAccountValue - 928000) < 0.001,
  '100 萬元四年費用方案應以原始本金固定計算 72,000 元',
)
assert(
  noLoanFeePlanning.riskSnapshot.totalProductFees > 0 &&
    noLoanFeePlanning.stressedAssetValue !== null,
  '無貸款規劃仍應產生費用與市場壓力結果',
)
assert(
  Math.abs(sevenYearFeePlanning.totalProductFees - 72000) < 0.001,
  '四年期費用應只計算前 48 個月，第 49 月後不再增加',
)

const policyLoanPlanning = calculatePlanningResult({
  planningMode: 'policyLoan',
  principal: dividend.principal,
  ownCapital: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  loanRatio: 40,
  annualLoanRate: 4,
  feeType: 'fourYear',
  stressType: 'none',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
})
assert(
  policyLoanPlanning.policyInvestedCapital === 1000000,
  '一般保單貸款的實際投入本金應維持 100 萬元',
)
assert(
  policyLoanPlanning.policyLoanPrincipal === 400000 &&
    policyLoanPlanning.annualLoanInterest === 16000,
  '一般保單貸款 40 萬元、利率 4% 的年度利息應為 16,000 元',
)
assert(
  Math.abs(
    policyLoanPlanning.annualGrossDistribution - dividend.annualDividend,
  ) < 0.001,
  '一般保單貸款配息仍應以 100 萬元計算',
)
assert(
  Math.abs(policyLoanPlanning.totalProductFees - 72000) < 0.001,
  '一般保單貸款商品費用應以 100 萬元原始保單投入本金固定計算',
)
assert(
  policyLoanPlanning.monthlyInterestReserve === null &&
    policyLoanPlanning.monthlyNetDistribution === null &&
    policyLoanPlanning.annualNetDistribution === null &&
    policyLoanPlanning.cumulativeNetDistribution === null &&
    policyLoanPlanning.netCashflowRateOnOwnCapital === null,
  '一般保單貸款不可扣除配息或產生淨配息率',
)

const amountDrivenTerms = resolvePolicyLoanTerms({
  capital: 1000000,
  policyLoanRatio: 40,
  policyLoanAmount: 350000,
  inputSource: 'amount',
})
assert(
  amountDrivenTerms.valid &&
    amountDrivenTerms.policyLoanAmount === 350000 &&
    amountDrivenTerms.policyLoanRatio === 35,
  '借款金額 35 萬元應反向同步為貸款比例 35%',
)

const boundaryTerms = resolvePolicyLoanTerms({
  capital: 1000000,
  policyLoanRatio: 0,
  policyLoanAmount: 600000,
  inputSource: 'amount',
})
assert(
  boundaryTerms.valid && boundaryTerms.policyLoanRatio === 60,
  '借款金額 60 萬元應允許計算',
)

const overAmountTerms = resolvePolicyLoanTerms({
  capital: 1000000,
  policyLoanRatio: 0,
  policyLoanAmount: 600100,
  inputSource: 'amount',
})
const overRatioTerms = resolvePolicyLoanTerms({
  capital: 1000000,
  policyLoanRatio: 60.01,
  policyLoanAmount: 0,
  inputSource: 'ratio',
})
assert(
  !overAmountTerms.valid &&
    !overRatioTerms.valid &&
    overAmountTerms.error === '保單借款不得超過投入本金的60%。' &&
    overRatioTerms.error === '保單借款不得超過投入本金的60%。',
  '借款金額或比例超過 60% 時都必須拒絕規劃',
)
let overLimitPlanningRejected = false
try {
  calculatePlanningResult({
    planningMode: 'policyLoan',
    principal: 1000000,
    ownCapital: 1000000,
    policyLoanAmount: 600100,
    policyLoanRatio: 60.01,
    policyLoanInputSource: 'amount',
    allocations: qqqPlan.allocations,
    years: 4,
    annualLoanRate: 4,
    feeType: 'none',
    stressType: 'none',
    assetData,
    exchangeRates: exchangePayload.rates,
    feePlans: feePayload.feePlans,
  })
} catch (error) {
  overLimitPlanningRejected =
    error.message === '保單借款不得超過投入本金的60%。'
}
assert(overLimitPlanningRejected, '超過 60% 不得產生或更新規劃結果')

const sponsorPlanning = calculatePlanningResult({
  planningMode: 'sponsorProject',
  principal: dividend.principal,
  ownCapital: 1000000,
  sponsorCapital: 1000000,
  sponsorPolicyLoan: 800000,
  allocations: qqqPlan.allocations,
  years: 4,
  loanRatio: 40,
  annualLoanRate: 4,
  feeType: 'fourYear',
  stressType: 'normal',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
})
assert(
  sponsorPlanning.policyInvestedCapital === 2000000,
  '金主專案保單實際投入本金應為 200 萬元',
)
assert(
  Math.abs(
    sponsorPlanning.annualGrossDistribution -
      dividend.annualDividend * 2,
  ) < 0.001,
  '金主專案毛配息應以 200 萬元計算',
)
assert(
  sponsorPlanning.annualLoanInterest === 40000,
  '金主專案貸款 100 萬元、利率 4% 的年度利息應為 40,000 元',
)
assert(
  sponsorPlanning.monthlyNetDistribution !== null &&
    sponsorPlanning.annualNetDistribution ===
      sponsorPlanning.annualGrossDistribution - 40000,
  '金主專案仍應顯示扣除貸款利息後的淨配息',
)
assert(
  sponsorPlanning.policyLoanPrincipal === 1000000 &&
    sponsorPlanning.initialAccountLoanRatio === 50,
  '金主專案貸款本金應固定等於金主借款，並忽略舊的獨立貸款欄位',
)
assert(
  !('unpaidSponsorBalance' in sponsorPlanning) &&
    !('extraWithdrawnCapital' in sponsorPlanning),
  '金主專案結果不應再包含部分歸還或額外領出欄位',
)
assert(
  Math.abs(sponsorPlanning.riskSnapshot.totalProductFees - 144000) < 0.001,
  '金主專案商品費用應以 200 萬元原始投入本金固定計算 144,000 元',
)

const sponsorStress = calculateStressTestResult({
  principal: sponsorPlanning.policyInvestedCapital,
  allocations: qqqPlan.allocations,
  years: 4,
  useLoan: true,
  loanRatio: 0,
  policyLoanPrincipal: sponsorPlanning.policyLoanPrincipal,
  planningMode: 'sponsorProject',
  ownCapital: sponsorPlanning.ownCapital,
  sponsorCapital: sponsorPlanning.sponsorCapital,
  annualLoanRate: 4,
  feeType: 'fourYear',
  stressType: 'normal',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
  accumulatedDividend: sponsorPlanning.cumulativeGrossDistribution,
})
assert(
  sponsorStress.loanPrincipal === 1000000 &&
    Math.abs(sponsorStress.warningAccountValue - 1000000 / 0.85) < 0.001,
  '金主專案壓力測試應使用 100 萬元貸款本金計算貸款比率與警戒價值',
)

const noLoanStress = calculateStressTestResult({
  principal: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  useLoan: false,
  loanRatio: 40,
  annualLoanRate: 3.85,
  feeType: 'fourYear',
  stressType: 'normal',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
  accumulatedDividend: dividend.accumulatedDividend,
})
const expectedWeightedMarketScenario = Object.entries(
  qqqPlan.allocations,
).reduce(
  (sum, [assetId, allocation]) =>
    sum +
    Number(allocation) *
      Number(assetData[assetId].marketScenarioDrawdown),
  0,
)
const expectedNormalMarketValue =
  dividend.principal * (1 + expectedWeightedMarketScenario / 100)
assert(noLoanStress.valid, '無貸款壓力測試應可完成')
assert(
  noLoanStress.monthlyProjection === null &&
    Math.abs(
      noLoanStress.marketStressedValue - expectedNormalMarketValue,
    ) < 0.001,
  '一般市場試算應直接套用 Excel 情境百分比一次，不可逐月複利',
)
assert(
  Math.abs(noLoanStress.totalProductFees - 72000) < 0.001,
  '一般市場試算商品費用應以原始投入本金固定計算',
)
assert(
  Math.abs(
    noLoanStress.finalStressedAccountValue -
      (expectedNormalMarketValue - 72000),
  ) < 0.001,
  '一般市場試算期末帳戶價值應為情境後價值減去固定商品費用',
)
assert(
  Math.abs(
    noLoanStress.marketWeightedDrawdownPercentage -
      expectedWeightedMarketScenario,
  ) < 0.001,
  '一般市場試算應保留 Excel 情境百分比正負號並依配置加權',
)
assert(
  Math.abs(
    noLoanStress.accumulatedDividend - dividend.accumulatedDividend,
  ) < 0.001,
  '一般市場試算累積已領配息應沿用基本配息結果，不重複逐月扣減本金',
)
assert(
  Math.abs(
    noLoanStress.accountValueDrawdownPercentage -
      ((dividend.principal - noLoanStress.finalStressedAccountValue) /
        dividend.principal) *
        100,
  ) < 0.001,
  '帳戶價值跌幅應以本金與最終壓力後帳戶價值計算',
)
assert(noLoanStress.safetyStatus === '未使用', '無貸款時應顯示未使用')

const loanStress = calculateStressTestResult({
  principal: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  useLoan: true,
  loanRatio: 40,
  annualLoanRate: 3.85,
  feeType: 'fourYear',
  stressType: 'extreme',
  assetData,
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
  accumulatedDividend: dividend.accumulatedDividend,
})
const expectedExtremeWeightedDrawdown = Object.entries(
  qqqPlan.allocations,
).reduce(
  (sum, [assetId, allocation]) =>
    sum +
    Number(allocation) *
      Math.abs(Number(assetData[assetId].extremeStressDrawdown)),
  0,
)
const expectedExtremeMarketValue =
  dividend.principal * (1 - expectedExtremeWeightedDrawdown / 100)
assert(loanStress.valid, '有貸款壓力測試應可完成')
assert(
  Math.abs(loanStress.marketStressedValue - expectedExtremeMarketValue) <
    0.001,
  '極端市場壓力後價值應依目前標的壓力跌幅計算',
)
assert(
  Math.abs(
    loanStress.finalStressedAccountValue -
      (expectedExtremeMarketValue - loanStress.totalProductFees),
  ) < 0.001,
  '極端最終壓力後帳戶價值應為市場壓力後價值減去商品費用',
)
assert(
  loanStress.monthlyProjection === null &&
    Math.abs(loanStress.totalProductFees - 72000) < 0.001,
  '極端壓力測試應維持原始本金套用極端跌幅及完整保守費用',
)
assert(
  Math.abs(
    loanStress.marketWeightedDrawdownPercentage -
      expectedExtremeWeightedDrawdown,
  ) < 0.001,
  '極端市場壓力加權跌幅應依目前標的設定加權計算',
)
assert(
  Math.abs(
    loanStress.stressedLoanRatio -
      (loanStress.loanPrincipal / loanStress.finalStressedAccountValue) * 100,
  ) < 0.0001,
  '壓力後貸款比率應依貸款本金除以壓力後帳戶價值計算',
)
assert(loanStress.safetyStatus === '達警戒線', '85% 以上應達警戒線')
assert(
  loanStress.belowWarningAccountValue,
  '壓力後帳戶價值應低於 85% 警戒帳戶價值',
)

const safetyTestAssetData = {
  safetyAsset: {
    assetId: 'safetyAsset',
    displayName: '安全水位測試標的',
    currency: 'TWD',
    nav: 1,
    distributionPerUnit: 0,
    marketScenarioDrawdown: 0,
    extremeStressDrawdown: 0,
  },
}
const calculateSafetyCase = (stressedAccountValue) =>
  calculateStressTestResult({
    principal: stressedAccountValue,
    allocations: { safetyAsset: 100 },
    years: 1,
    useLoan: true,
    loanRatio: 0,
    policyLoanPrincipal: 500000,
    planningMode: 'policyLoan',
    annualLoanRate: 4,
    feeType: 'none',
    stressType: 'normal',
    assetData: safetyTestAssetData,
    exchangeRates: [],
    feePlans: feePayload.feePlans,
    accumulatedDividend: 999999,
  })

const aboveSafetyLine = calculateSafetyCase(600000)
assert(
  Math.abs(aboveSafetyLine.safeAccountValue - 588235.2941176471) < 0.001 &&
    Math.abs(aboveSafetyLine.safetyValueGap - 11764.7058823529) < 0.001 &&
    aboveSafetyLine.requiredTopUp === 0 &&
    Math.abs(aboveSafetyLine.stressedLoanRatio - 83.3333333333) < 0.001,
  '高於 85% 安全水位時，差距應為正且需補資金為 0',
)

const belowSafetyLine = calculateSafetyCase(560000)
assert(
  Math.abs(belowSafetyLine.safetyValueGap + 28235.2941176471) < 0.001 &&
    Math.abs(belowSafetyLine.requiredTopUp - 28235.2941176471) < 0.001 &&
    Math.abs(belowSafetyLine.stressedLoanRatio - 89.2857142857) < 0.001,
  '低於 85% 安全水位時，需補資金應等於安全價值差距的絕對值',
)

const atSafetyLine = calculateSafetyCase(500000 / 0.85)
assert(
  Math.abs(atSafetyLine.safetyValueGap) < 0.001 &&
    atSafetyLine.requiredTopUp === 0 &&
    Math.abs(atSafetyLine.stressedLoanRatio - 85) < 0.001,
  '剛好位於 85% 安全水位時，差距與需補資金應為 0',
)

assert(
  noLoanStress.safeAccountValue === null &&
    noLoanStress.safetyValueGap === null &&
    noLoanStress.requiredTopUp === null,
  '無保單貸款時不應計算安全帳戶價值、資金安全差距與需補資金',
)

const missingReturnSetting = calculateStressTestResult({
  principal: dividend.principal,
  allocations: qqqPlan.allocations,
  years: 4,
  useLoan: false,
  loanRatio: 0,
  annualLoanRate: 0,
  feeType: 'none',
  stressType: 'normal',
  assetData: {
    ...assetData,
    qqq: { ...assetData.qqq, marketScenarioDrawdown: null },
  },
  exchangeRates: exchangePayload.rates,
  feePlans: feePayload.feePlans,
  accumulatedDividend: dividend.accumulatedDividend,
})
assert(
  !missingReturnSetting.valid &&
    missingReturnSetting.error.includes('納斯達克100指數ETF'),
  '一般市場試算缺少情境百分比時應明確指出標的',
)

console.log('資料與計算邏輯測試成功。')
