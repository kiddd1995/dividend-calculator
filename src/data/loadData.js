const dataUrl = (filename) => `${import.meta.env.BASE_URL}data/${filename}`

async function fetchJson(filename) {
  const response = await fetch(dataUrl(filename))
  if (!response.ok) {
    throw new Error(`${filename} 讀取失敗（HTTP ${response.status}）`)
  }
  return response.json()
}

async function fetchOptionalJson(filename, fallbackValue) {
  try {
    return await fetchJson(filename)
  } catch {
    return fallbackValue
  }
}

function assertData(condition, message) {
  if (!condition) throw new Error(message)
}

function firstText(...values) {
  return values.find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  ) ?? null
}

function validPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return null
}

function validNonNegativeNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return number
  }
  return null
}

export async function loadAppData() {
  const [assetsPayload, assetsConfigPayload, plansPayload, exchangePayload, feePayload] =
    await Promise.all([
      fetchOptionalJson('assets-live.json', {
        assets: [],
        dataStatus: '即時標的資料尚未載入，使用備援資料',
      }),
      fetchJson('assets-config.json'),
      fetchJson('plans.json'),
      fetchJson('exchange-live.json'),
      fetchJson('fee-plans.json'),
    ])

  assertData(
    Array.isArray(assetsConfigPayload.assets) &&
      assetsConfigPayload.assets.length > 0,
    '標的設定資料為空',
  )
  assertData(
    Array.isArray(plansPayload.plans) && plansPayload.plans.length > 0,
    '專案設定為空',
  )
  assertData(
    Array.isArray(exchangePayload.rates),
    '匯率資料格式不正確',
  )
  assertData(
    Array.isArray(feePayload.feePlans),
    '費用設定格式不正確',
  )

  const assetConfigData = Object.fromEntries(
    assetsConfigPayload.assets.map((asset) => [asset.assetId, asset]),
  )
  const liveAssets = Array.isArray(assetsPayload?.assets)
    ? assetsPayload.assets
    : []
  const liveAssetData = Object.fromEntries(
    liveAssets.map((asset) => [asset.assetId, asset]),
  )
  const assetIds = new Set([
    ...Object.keys(assetConfigData),
    ...Object.keys(liveAssetData),
  ])
  const mergedAssets = [...assetIds].map((assetId) => {
    const config = assetConfigData[assetId] ?? {}
    const live = liveAssetData[assetId] ?? {}
    const liveNav = validPositiveNumber(live.nav)
    const nav = liveNav ?? validPositiveNumber(config.nav, config.fallbackNav)
    const distributionPerUnit =
      validNonNegativeNumber(live.distributionPerUnit) ??
      validNonNegativeNumber(
        config.distributionPerUnit,
        config.fallbackDistributionPerUnit,
      )
    const annualDistributionRate =
      validNonNegativeNumber(live.annualDistributionRate) ??
      validNonNegativeNumber(
        config.annualDistributionRate,
        config.fallbackAnnualDistributionRate,
      )
    const liveNavSourceUrl = firstText(
      live.navSourceUrl,
      live.sourceUrl,
      live.navUrl,
      live['淨值網址'],
    )
    const configNavSourceUrl = firstText(
      config.navSourceUrl,
      config.sourceUrl,
      config.navUrl,
      config['淨值網址'],
    )

    return {
      ...config,
      ...live,
      assetId,
      nav,
      navDate:
        (liveNav && firstText(live.navDate)) ??
        firstText(config.navDate, config.fallbackDate),
      navSourceUrl:
        (liveNav && liveNavSourceUrl) ?? configNavSourceUrl,
      navStatus: liveNav ? live.navStatus ?? 'success' : 'fallback',
      distributionPerUnit,
      annualDistributionRate,
      marketScenarioDrawdown: config.marketScenarioDrawdown,
      extremeStressDrawdown: config.extremeStressDrawdown,
    }
  })
  const assetData = Object.fromEntries(
    mergedAssets.map((asset) => [asset.assetId, asset]),
  )
  const enabledAssets = mergedAssets.filter((asset) => asset.enabled)

  for (const plan of plansPayload.plans) {
    for (const assetId of Object.keys(plan.allocations)) {
      assertData(
        assetData[assetId],
        `專案「${plan.name}」引用不存在的標的 ${assetId}`,
      )
    }
  }

  return {
    assetData,
    enabledAssets,
    fixedPlans: plansPayload.plans,
    defaultProjectId:
      plansPayload.defaultProjectId ?? plansPayload.plans[0].id,
    exchangeRates: exchangePayload.rates,
    exchangeRateStaleAfterDays: exchangePayload.staleAfterDays ?? 7,
    feePlans: feePayload.feePlans,
    dataStatus: assetsPayload?.dataStatus ?? '資料已載入',
    generatedAt: assetsPayload?.generatedAt ?? null,
  }
}

export function getPrimaryExchangeRate(exchangeRates, currencyPair) {
  return exchangeRates.find((rate) => rate.currencyPair === currencyPair)
}

export function isExchangeRateStale(rate, staleAfterDays) {
  if (!rate?.rateDate) return true
  const rateDate = new Date(`${rate.rateDate}T00:00:00`)
  if (Number.isNaN(rateDate.getTime())) return true
  const ageInDays = (Date.now() - rateDate.getTime()) / 86400000
  return ageInDays > staleAfterDays
}
