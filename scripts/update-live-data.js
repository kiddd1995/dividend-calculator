import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'
import { downloadDecodedText } from './lib/html.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDirectory = path.join(projectRoot, 'public', 'data')
const assetsConfigPath = path.join(dataDirectory, 'assets.json')
const exchangeConfigPath = path.join(dataDirectory, 'exchange-rates.json')
const assetsLivePath = path.join(dataDirectory, 'assets-live.json')
const exchangeLivePath = path.join(dataDirectory, 'exchange-live.json')

function normalizeDate(value) {
  const match = String(value ?? '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function positiveNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0])
  return Number.isFinite(number) && number > 0 ? number : null
}

function nonNegativeNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0])
  return Number.isFinite(number) && number >= 0 ? number : null
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function loadHtml(text) {
  const $ = cheerio.load(text)
  const title = cleanText($('title').text() || $('h1,h2,h3,h4').first().text())
  if (title && !/[\u3400-\u9fff]/.test(title) && /(?:�|Ã|Â)/.test(title)) {
    throw new Error('中文欄位疑似亂碼')
  }
  return $
}

function parseMoneyDjNav(html) {
  const $ = loadHtml(html)
  let result = null
  $('table').each((_, table) => {
    if (result) return
    const headerText = cleanText($(table).find('thead').text())
    if (!headerText.includes('日期') || !headerText.includes('淨值')) return
    $(table)
      .find('tbody tr')
      .each((__, row) => {
        if (result) return
        const cells = $(row)
          .find('td')
          .map((___, cell) => cleanText($(cell).text()))
          .get()
        const date = normalizeDate(cells[0])
        const nav = positiveNumber(cells[1])
        if (date && nav) result = { nav, navDate: date }
      })
  })
  if (!result) throw new Error('找不到最新淨值與淨值日期')
  return result
}

function parseMoneyDjDistribution(html) {
  const $ = loadHtml(html)
  let result = null
  $('table').each((_, table) => {
    if (result) return
    const headerText = cleanText($(table).find('thead').text())
    if (
      !headerText.includes('配息基準日') ||
      !headerText.includes('除息日') ||
      !headerText.includes('息值或比例')
    ) {
      return
    }
    $(table)
      .find('tbody tr')
      .each((__, row) => {
        if (result) return
        const cells = $(row)
          .find('td')
          .map((___, cell) => cleanText($(cell).text()))
          .get()
        const baseDateIndex = cells.findIndex((cell) => normalizeDate(cell))
        if (baseDateIndex < 0) return
        const distributionDate =
          normalizeDate(cells[baseDateIndex + 1]) ??
          normalizeDate(cells[baseDateIndex])
        const statusIndex = cells.findIndex((cell) => cell.includes('配息'))
        const distributionPerUnit = nonNegativeNumber(
          cells[statusIndex >= 0 ? statusIndex + 1 : baseDateIndex + 3],
        )
        if (distributionDate && distributionPerUnit !== null) {
          result = { distributionPerUnit, distributionDate }
        }
      })
  })
  if (!result) throw new Error('找不到最新每單位配息與配息日期')

  const pageText = cleanText($.root().text())
  const annualRateMatch = pageText.match(
    /年化(?:配息)?率[^\d]{0,20}(\d+(?:\.\d+)?)\s*%/,
  )
  if (annualRateMatch) {
    result.annualDistributionRate = Number(annualRateMatch[1]) / 100
  }
  return result
}

function parseQqqIdentifier(sourceUrl) {
  const url = new URL(sourceUrl)
  const identifier = new URLSearchParams(url.hash.slice(1)).get('ETFID')
  if (!identifier || !identifier.toUpperCase().includes('QQQ')) {
    throw new Error('QQQ 來源網址缺少有效的 ETFID')
  }
  return { url, identifier }
}

async function fetchQqqNav(asset) {
  const { url, identifier } = parseQqqIdentifier(asset.navSourceUrl)
  const endpoint = new URL('/ETFData/djjson/et011001json.djjson', url.origin)
  endpoint.searchParams.set('a', identifier)
  const { text } = await downloadDecodedText(endpoint.href, {
    expectChinese: false,
  })
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('QQQ 結構化資料格式無法解析')
  }
  const row = payload?.ResultSet?.Result?.[0]
  const nav = positiveNumber(row?.V45)
  const navDate = normalizeDate(row?.V46)
  if (!nav || !navDate) throw new Error('QQQ 結構化資料缺少最新價格或日期')
  return { nav, navDate }
}

async function fetchAssetNav(asset) {
  if (asset.assetId.toLowerCase() === 'qqq') return fetchQqqNav(asset)
  const { text } = await downloadDecodedText(asset.navSourceUrl)
  return parseMoneyDjNav(text)
}

async function fetchAssetDistribution(asset) {
  const { text } = await downloadDecodedText(asset.distributionSourceUrl)
  return parseMoneyDjDistribution(text)
}

function previousAssetById(previousPayload) {
  return new Map(
    (previousPayload?.assets ?? []).map((asset) => [asset.assetId, asset]),
  )
}

function canUsePreviousNav(previous) {
  return (
    previous &&
    positiveNumber(previous.nav) !== null &&
    previous.navDate &&
    ['success', 'previous'].includes(previous.navStatus)
  )
}

function canUsePreviousDistribution(previous) {
  return (
    previous &&
    nonNegativeNumber(previous.distributionPerUnit) !== null &&
    previous.distributionDate &&
    ['success', 'previous'].includes(previous.distributionStatus)
  )
}

function manualNav(asset, fetchedAt) {
  return {
    nav: asset.fallbackNav,
    navDate: asset.fallbackDate,
    navSourceName: asset.navSourceName,
    navSourceUrl: asset.navSourceUrl,
    navFetchedAt: fetchedAt,
    navStatus: 'manual',
    navFallbackLevel: 'manual',
    navFailureReason: null,
  }
}

function manualDistribution(asset, fetchedAt) {
  return {
    distributionPerUnit: asset.fallbackDistributionPerUnit,
    annualDistributionRate: asset.fallbackAnnualDistributionRate,
    distributionDate: asset.fallbackDate,
    distributionSourceName: asset.distributionSourceName,
    distributionSourceUrl: asset.distributionSourceUrl,
    distributionFetchedAt: fetchedAt,
    distributionStatus: 'manual',
    distributionFallbackLevel: 'manual',
    distributionFailureReason: null,
  }
}

async function updateAsset(asset, previous, fetchedAt) {
  const live = {
    assetId: asset.assetId,
    displayName: asset.displayName,
    enabled: asset.enabled,
    currency: asset.currency,
    autoUpdate: asset.autoUpdate,
    marketScenarioDrawdown: asset.marketScenarioDrawdown,
    extremeStressDrawdown: asset.extremeStressDrawdown,
  }

  if (!asset.autoUpdate || asset.navFetchMethod === 'manual') {
    Object.assign(live, manualNav(asset, fetchedAt))
  } else {
    try {
      const nav = await fetchAssetNav(asset)
      Object.assign(live, {
        ...nav,
        navSourceName: asset.navSourceName,
        navSourceUrl: asset.navSourceUrl,
        navFetchedAt: fetchedAt,
        navStatus: 'success',
        navFallbackLevel: 'live',
        navFailureReason: null,
      })
    } catch (error) {
      if (canUsePreviousNav(previous)) {
        Object.assign(live, {
          nav: previous.nav,
          navDate: previous.navDate,
          navSourceName: previous.navSourceName ?? asset.navSourceName,
          navSourceUrl: previous.navSourceUrl ?? asset.navSourceUrl,
          navFetchedAt: fetchedAt,
          navStatus: 'previous',
          navFallbackLevel: 'previous',
          navFailureReason: error.message,
        })
      } else {
        Object.assign(live, {
          ...manualNav(asset, fetchedAt),
          navStatus: 'fallback',
          navFallbackLevel: 'manual',
          navFailureReason: error.message,
        })
      }
    }
  }

  if (!asset.autoUpdate || asset.distributionFetchMethod === 'manual') {
    Object.assign(live, manualDistribution(asset, fetchedAt))
  } else {
    try {
      const distribution = await fetchAssetDistribution(asset)
      Object.assign(live, {
        distributionPerUnit: distribution.distributionPerUnit,
        annualDistributionRate:
          distribution.annualDistributionRate ??
          asset.fallbackAnnualDistributionRate,
        distributionDate: distribution.distributionDate,
        distributionSourceName: asset.distributionSourceName,
        distributionSourceUrl: asset.distributionSourceUrl,
        distributionFetchedAt: fetchedAt,
        distributionStatus: 'success',
        distributionFallbackLevel: 'live',
        distributionFailureReason: null,
        annualDistributionRateStatus: distribution.annualDistributionRate
          ? 'live'
          : 'manual',
      })
    } catch (error) {
      if (canUsePreviousDistribution(previous)) {
        Object.assign(live, {
          distributionPerUnit: previous.distributionPerUnit,
          annualDistributionRate: previous.annualDistributionRate,
          distributionDate: previous.distributionDate,
          distributionSourceName:
            previous.distributionSourceName ?? asset.distributionSourceName,
          distributionSourceUrl:
            previous.distributionSourceUrl ?? asset.distributionSourceUrl,
          distributionFetchedAt: fetchedAt,
          distributionStatus: 'previous',
          distributionFallbackLevel: 'previous',
          distributionFailureReason: error.message,
          annualDistributionRateStatus:
            previous.annualDistributionRateStatus ?? 'previous',
        })
      } else {
        Object.assign(live, {
          ...manualDistribution(asset, fetchedAt),
          distributionStatus: 'fallback',
          distributionFallbackLevel: 'manual',
          distributionFailureReason: error.message,
          annualDistributionRateStatus: 'manual',
        })
      }
    }
  }

  return live
}

function parseBotExchange(html) {
  const $ = loadHtml(html)
  let result = null
  $('table tbody tr').each((_, row) => {
    if (result || !cleanText($(row).text()).includes('(USD)')) return
    const cells = $(row)
      .find('td')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
    const spotBuyingRate = positiveNumber(cells[3])
    const spotSellingRate = positiveNumber(cells[4])
    if (spotBuyingRate && spotSellingRate) {
      result = { spotBuyingRate, spotSellingRate }
    }
  })
  const rateDate =
    normalizeDate($('h1').first().text()) ?? normalizeDate($.root().text())
  if (!result || !rateDate) throw new Error('找不到美元即期買入、賣出或匯率日期')
  return { ...result, rateDate }
}

function parseKgiExchange(html) {
  const $ = loadHtml(html)
  let result = null
  $('.kgibOtherCus004__item').each((_, row) => {
    if (result || cleanText($(row).find('.currency-en-name').text()) !== 'USD') {
      return
    }
    const values = $(row)
      .find('.kgibOtherCus004__item-val')
      .map((__, value) => cleanText($(value).text()))
      .get()
    const spotBuyingRate = positiveNumber(values[1])
    const spotSellingRate = positiveNumber(values[2])
    if (spotBuyingRate && spotSellingRate) {
      result = { spotBuyingRate, spotSellingRate }
    }
  })
  const pageText = cleanText($.root().text())
  const rateDate = normalizeDate(
    pageText.match(/掛牌時間[^\d]*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/)?.[1],
  )
  if (!result || !rateDate) throw new Error('找不到美元即期買入、賣出或匯率日期')
  return { ...result, rateDate }
}

export async function fetchExchangeSource(source) {
  const { text } = await downloadDecodedText(source.sourceUrl)
  if (source.sourceUrl.includes('rate.bot.com.tw')) return parseBotExchange(text)
  if (source.sourceUrl.includes('kgibank.com.tw')) return parseKgiExchange(text)
  throw new Error('尚未支援此匯率來源')
}

function validPreviousRate(rate) {
  return (
    rate &&
    positiveNumber(rate.spotBuyingRate) !== null &&
    positiveNumber(rate.spotSellingRate) !== null &&
    rate.rateDate
  )
}

async function updateExchangeRate(config, previous, fetchedAt) {
  const attempts = [
    ['primary', config.primarySource],
    ['secondary', config.secondarySource],
  ]
  const sourceErrors = []

  if (config.autoUpdate) {
    for (const [fallbackLevel, source] of attempts) {
      if (source.fetchMethod === 'manual') continue
      try {
        const data = await fetchExchangeSource(source)
        return {
          currencyPair: config.currencyPair,
          ...data,
          sourceName: source.sourceName,
          sourceUrl: source.sourceUrl,
          fetchedAt,
          status: 'success',
          fallbackLevel,
          failureReason: fallbackLevel === 'secondary' ? sourceErrors.join('；') : null,
        }
      } catch (error) {
        sourceErrors.push(`${source.sourceName}：${error.message}`)
      }
    }
  }

  if (validPreviousRate(previous)) {
    return {
      ...previous,
      fetchedAt,
      status: 'previous',
      fallbackLevel: 'previous',
      failureReason: sourceErrors.join('；') || '自動更新未啟用',
    }
  }

  return {
    currencyPair: config.currencyPair,
    ...config.manualFallback,
    sourceName: 'Excel 人工備援',
    sourceUrl: null,
    fetchedAt,
    status: 'manual',
    fallbackLevel: 'manual',
    failureReason: sourceErrors.join('；') || '自動更新未啟用',
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJson(filePath, payload) {
  const temporaryPath = `${filePath}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, filePath)
}

function summarizeAsset(asset) {
  return `${asset.assetId}: 淨值=${asset.navStatus}, 配息=${asset.distributionStatus}`
}

async function main() {
  const fetchedAt = new Date().toISOString()
  const [assetsConfig, exchangeConfig, previousAssets, previousExchange] =
    await Promise.all([
      readJson(assetsConfigPath),
      readJson(exchangeConfigPath),
      readJson(assetsLivePath, { assets: [] }),
      readJson(exchangeLivePath, { rates: [] }),
    ])
  const previousAssetsMap = previousAssetById(previousAssets)
  const previousRatesMap = new Map(
    (previousExchange.rates ?? []).map((rate) => [rate.currencyPair, rate]),
  )

  const assets = []
  for (const asset of assetsConfig.assets) {
    const live = await updateAsset(
      asset,
      previousAssetsMap.get(asset.assetId),
      fetchedAt,
    )
    assets.push(live)
    console.log(summarizeAsset(live))
  }

  const rates = []
  for (const rateConfig of exchangeConfig.rates) {
    const live = await updateExchangeRate(
      rateConfig,
      previousRatesMap.get(rateConfig.currencyPair),
      fetchedAt,
    )
    rates.push(live)
    console.log(
      `${live.currencyPair}: 匯率=${live.status}, fallbackLevel=${live.fallbackLevel}`,
    )
  }

  await Promise.all([
    writeJson(assetsLivePath, {
      generatedAt: fetchedAt,
      dataStatus: '自動更新資料',
      assets,
    }),
    writeJson(exchangeLivePath, {
      generatedAt: fetchedAt,
      staleAfterDays: exchangeConfig.staleAfterDays ?? 7,
      rates,
    }),
  ])
  console.log('自動資料更新完成。')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`自動資料更新失敗：${error.message}`)
    process.exitCode = 1
  })
}
