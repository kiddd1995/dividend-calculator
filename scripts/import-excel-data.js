import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workbookName = '配息計算機資料設定表_自動抓取版.xlsx'
const inputPath = path.join(projectRoot, 'data-source', workbookName)
const outputDirectory = path.join(projectRoot, 'public', 'data')
const requiredSheets = ['標的設定', '專案設定', '匯率設定', '費用設定']
const automaticMethods = new Set(['html', 'api'])
const validMethods = new Set(['html', 'api', 'manual'])

function readRows(worksheet) {
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
  })
  const headers = (matrix[0] ?? []).map((value) => String(value ?? '').trim())
  const rows = []

  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index]
    const firstValue = row[0]
    if (firstValue === null || firstValue === undefined || firstValue === '') break
    rows.push({
      ...Object.fromEntries(
        headers.map((header, columnIndex) => [header, row[columnIndex]]),
      ),
      __rowNumber: index + 1,
    })
  }
  return rows
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return null
}

function parseNumber(value, { blankAsZero = false } = {}) {
  if (typeof value === 'number') return value
  if (value === null || value === undefined || value === '') {
    return blankAsZero ? 0 : Number.NaN
  }
  const normalized = String(value).replace(/,/g, '').trim()
  if (blankAsZero && ['--', '-', '—'].includes(normalized)) return 0
  return Number(normalized.replace(/%$/, '')) / (normalized.endsWith('%') ? 100 : 1)
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().replaceAll('/', '-')
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) return null
    const [year, month, day] = normalized.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    ) {
      return null
    }
    return date
  }
  return null
}

function formatDate(value) {
  const date = parseDate(value)
  if (!date) return null
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function stringValue(value) {
  return String(value ?? '').trim()
}

function normalizeMethod(value) {
  return stringValue(value).toLowerCase()
}

function requireHeaders(worksheet, sheetName, expectedHeaders, errors) {
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
  })
  const headers = (matrix[0] ?? []).map((value) => String(value ?? '').trim())
  for (const header of expectedHeaders) {
    if (!headers.includes(header)) {
      errors.push(`工作表「${sheetName}」缺少欄位：${header}`)
    }
  }
}

function requireAnyHeader(worksheet, sheetName, acceptedHeaders, label, errors) {
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
  })
  const headers = (matrix[0] ?? []).map((value) => String(value ?? '').trim())
  if (!acceptedHeaders.some((header) => headers.includes(header))) {
    errors.push(
      `工作表「${sheetName}」缺少欄位：${label}（可相容：${acceptedHeaders.join('、')}）`,
    )
  }
}

function validateSource({
  row,
  rowLabel,
  dataLabel,
  method,
  sourceName,
  sourceUrl,
  errors,
}) {
  if (!validMethods.has(method)) {
    errors.push(
      `${rowLabel}第 ${row.__rowNumber} 列：${dataLabel}抓取方式必須為 html、api 或 manual`,
    )
    return
  }
  if (automaticMethods.has(method) && !sourceUrl) {
    errors.push(
      `${rowLabel}第 ${row.__rowNumber} 列：${dataLabel}抓取方式為 ${method} 時，${dataLabel}網址不可空白`,
    )
  }
  if (automaticMethods.has(method) && !sourceName) {
    errors.push(
      `${rowLabel}第 ${row.__rowNumber} 列：${dataLabel}抓取方式為 ${method} 時，${dataLabel}來源名稱不可空白`,
    )
  }
}

function validateAndTransform(workbook) {
  const errors = []
  for (const sheetName of requiredSheets) {
    if (!workbook.SheetNames.includes(sheetName)) {
      errors.push(`缺少必要工作表：${sheetName}`)
    }
  }
  if (errors.length) return { errors }

  const assetsSheet = workbook.Sheets['標的設定']
  const projectsSheet = workbook.Sheets['專案設定']
  const ratesSheet = workbook.Sheets['匯率設定']
  const feesSheet = workbook.Sheets['費用設定']

  requireHeaders(
    assetsSheet,
    '標的設定',
    [
      'assetId',
      '顯示名稱',
      'enabled',
      '幣別',
      'autoUpdate',
      '淨值來源名稱',
      '淨值網址',
      '淨值抓取方式',
      '配息來源名稱',
      '配息網址',
      '配息抓取方式',
      '備援淨值',
      '備援每單位配息',
      '備援年化配息率',
      '備援資料日期',
      '極端壓力跌幅',
    ],
    errors,
  )
  requireAnyHeader(
    assetsSheet,
    '標的設定',
    ['一般市場試算', '一般壓力跌幅', 'normalStressDrawdown'],
    '一般市場試算',
    errors,
  )
  requireHeaders(
    projectsSheet,
    '專案設定',
    ['projectId', '專案名稱', 'assetId', '比例', '排序', 'enabled'],
    errors,
  )
  requireHeaders(
    ratesSheet,
    '匯率設定',
    [
      'currencyPair',
      'autoUpdate',
      '主要來源名稱',
      '主要匯率網址',
      '主要抓取方式',
      '備援來源名稱',
      '備援匯率網址',
      '備援抓取方式',
      '備援即期買入',
      '備援即期賣出',
      '備援資料日期',
    ],
    errors,
  )
  requireHeaders(
    feesSheet,
    '費用設定',
    ['feePlanId', '費用名稱', '起始月', '結束月', '月費率', 'enabled'],
    errors,
  )
  if (errors.length) return { errors }

  const assetRows = readRows(assetsSheet)
  const projectRows = readRows(projectsSheet)
  const rateRows = readRows(ratesSheet)
  const feeRows = readRows(feesSheet)

  const assetIds = new Set()
  const assets = assetRows.map((row) => {
    const assetId = stringValue(row.assetId)
    const enabled = parseBoolean(row.enabled)
    const autoUpdate = parseBoolean(row.autoUpdate)
    const navFetchMethod = normalizeMethod(row['淨值抓取方式'])
    const distributionFetchMethod = normalizeMethod(row['配息抓取方式'])
    const navSourceName = stringValue(row['淨值來源名稱'])
    const navSourceUrl = stringValue(row['淨值網址'])
    const distributionSourceName = stringValue(row['配息來源名稱'])
    const distributionSourceUrl = stringValue(row['配息網址'])
    const fallbackNav = parseNumber(row['備援淨值'])
    const fallbackDistributionPerUnit = parseNumber(row['備援每單位配息'])
    const fallbackAnnualDistributionRate = parseNumber(row['備援年化配息率'])
    const fallbackDate = formatDate(row['備援資料日期'])
    const marketScenarioDrawdown = parseNumber(
      row['一般市場試算'] ??
        row['一般壓力跌幅'] ??
        row.normalStressDrawdown,
    )
    const extremeStressDrawdown = Math.abs(parseNumber(row['極端壓力跌幅']))

    if (!assetId) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：assetId 不可空白`)
    } else if (assetIds.has(assetId)) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：assetId「${assetId}」重複`)
    }
    assetIds.add(assetId)

    if (enabled === null) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：enabled 必須為 TRUE 或 FALSE`)
    }
    if (autoUpdate === null) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：autoUpdate 必須為 TRUE 或 FALSE`)
    }
    if (!(fallbackNav > 0)) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：備援淨值必須大於 0`)
    }
    if (!(fallbackDistributionPerUnit >= 0)) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：備援每單位配息不可為負數`)
    }
    if (!(fallbackAnnualDistributionRate >= 0)) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：備援年化配息率不可為負數`)
    }
    if (!fallbackDate) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：備援資料日期格式無效`)
    }
    if (!(extremeStressDrawdown >= 0 && extremeStressDrawdown <= 1)) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：極端壓力跌幅必須介於 0% 至 100%`)
    }
    if (
      !Number.isFinite(marketScenarioDrawdown) ||
      marketScenarioDrawdown < -1
    ) {
      errors.push(`標的設定第 ${row.__rowNumber} 列：一般市場試算不可低於 -100%`)
    }

    validateSource({
      row,
      rowLabel: '標的設定',
      dataLabel: '淨值',
      method: navFetchMethod,
      sourceName: navSourceName,
      sourceUrl: navSourceUrl,
      errors,
    })
    validateSource({
      row,
      rowLabel: '標的設定',
      dataLabel: '配息',
      method: distributionFetchMethod,
      sourceName: distributionSourceName,
      sourceUrl: distributionSourceUrl,
      errors,
    })

    return {
      assetId,
      displayName: stringValue(row['顯示名稱']),
      enabled: enabled ?? false,
      currency: stringValue(row['幣別']).toUpperCase(),
      autoUpdate: autoUpdate ?? false,
      navSourceName: navSourceName || null,
      navSourceUrl: navSourceUrl || null,
      navFetchMethod,
      distributionSourceName: distributionSourceName || null,
      distributionSourceUrl: distributionSourceUrl || null,
      distributionFetchMethod,
      fallbackNav,
      fallbackDistributionPerUnit,
      fallbackAnnualDistributionRate,
      fallbackDate,
      marketScenarioDrawdown,
      extremeStressDrawdown,
      note: stringValue(row['備註']) || null,
    }
  })

  const projectsById = new Map()
  const projectAssetPairs = new Set()
  for (const row of projectRows) {
    const rowEnabled = parseBoolean(row.enabled)
    if (rowEnabled === false) continue
    if (rowEnabled === null) {
      errors.push(`專案設定第 ${row.__rowNumber} 列：enabled 必須為 TRUE 或 FALSE`)
    }
    const projectId = stringValue(row.projectId)
    const projectName = stringValue(row['專案名稱'])
    const assetId = stringValue(row.assetId)
    const allocation = parseNumber(row['比例'])
    const sortOrder = parseNumber(row['排序'])
    const pairKey = `${projectId}:${assetId}`

    if (!projectId || !projectName) {
      errors.push(`專案設定第 ${row.__rowNumber} 列：projectId 與專案名稱不可空白`)
    }
    if (!assetIds.has(assetId)) {
      errors.push(`專案設定第 ${row.__rowNumber} 列：引用不存在的 assetId「${assetId}」`)
    }
    if (!(allocation >= 0 && allocation <= 1)) {
      errors.push(`專案設定第 ${row.__rowNumber} 列：比例必須介於 0% 至 100%`)
    }
    if (projectAssetPairs.has(pairKey)) {
      errors.push(`專案設定第 ${row.__rowNumber} 列：同一專案不可重複使用 assetId「${assetId}」`)
    }
    projectAssetPairs.add(pairKey)

    if (!projectsById.has(projectId)) {
      projectsById.set(projectId, { id: projectId, name: projectName, allocations: [] })
    }
    projectsById.get(projectId).allocations.push({ assetId, allocation, sortOrder })
  }

  const plans = [...projectsById.values()].map((project) => {
    const total = project.allocations.reduce((sum, row) => sum + row.allocation, 0)
    if (Math.abs(total - 1) > 0.000001) {
      errors.push(
        `專案「${project.name}」配置合計為 ${(total * 100).toFixed(2)}%，必須等於 100%`,
      )
    }
    return {
      id: project.id,
      name: project.name,
      allocations: Object.fromEntries(
        project.allocations
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => [item.assetId, Math.round(item.allocation * 10000) / 100]),
      ),
    }
  })

  const rates = rateRows.map((row) => {
    const autoUpdate = parseBoolean(row.autoUpdate)
    const primaryFetchMethod = normalizeMethod(row['主要抓取方式'])
    const secondaryFetchMethod = normalizeMethod(row['備援抓取方式'])
    const primarySourceName = stringValue(row['主要來源名稱'])
    const primarySourceUrl = stringValue(row['主要匯率網址'])
    const secondarySourceName = stringValue(row['備援來源名稱'])
    const secondarySourceUrl = stringValue(row['備援匯率網址'])
    const manualSpotBuyingRate = parseNumber(row['備援即期買入'])
    const manualSpotSellingRate = parseNumber(row['備援即期賣出'])
    const manualRateDate = formatDate(row['備援資料日期'])

    if (autoUpdate === null) {
      errors.push(`匯率設定第 ${row.__rowNumber} 列：autoUpdate 必須為 TRUE 或 FALSE`)
    }
    validateSource({
      row,
      rowLabel: '匯率設定',
      dataLabel: '主要匯率',
      method: primaryFetchMethod,
      sourceName: primarySourceName,
      sourceUrl: primarySourceUrl,
      errors,
    })
    validateSource({
      row,
      rowLabel: '匯率設定',
      dataLabel: '備援匯率',
      method: secondaryFetchMethod,
      sourceName: secondarySourceName,
      sourceUrl: secondarySourceUrl,
      errors,
    })
    if (!(manualSpotBuyingRate > 0) || !(manualSpotSellingRate > 0)) {
      errors.push(`匯率設定第 ${row.__rowNumber} 列：人工備援即期匯率必須大於 0`)
    }
    if (!manualRateDate) {
      errors.push(`匯率設定第 ${row.__rowNumber} 列：備援資料日期格式無效`)
    }

    return {
      currencyPair: stringValue(row.currencyPair).toUpperCase(),
      autoUpdate: autoUpdate ?? false,
      primarySource: {
        sourceName: primarySourceName || null,
        sourceUrl: primarySourceUrl || null,
        fetchMethod: primaryFetchMethod,
      },
      secondarySource: {
        sourceName: secondarySourceName || null,
        sourceUrl: secondarySourceUrl || null,
        fetchMethod: secondaryFetchMethod,
      },
      manualFallback: {
        spotBuyingRate: manualSpotBuyingRate,
        spotSellingRate: manualSpotSellingRate,
        rateDate: manualRateDate,
      },
      note: stringValue(row['備註']) || null,
    }
  })

  const feePlansById = new Map()
  for (const row of feeRows) {
    const rowEnabled = parseBoolean(row.enabled)
    if (rowEnabled === false) continue
    if (rowEnabled === null) {
      errors.push(`費用設定第 ${row.__rowNumber} 列：enabled 必須為 TRUE 或 FALSE`)
    }
    const feePlanId = stringValue(row.feePlanId)
    const feePlanName = stringValue(row['費用名稱'])
    const fromMonth = parseNumber(row['起始月'])
    const toMonth = parseNumber(row['結束月'])
    const monthlyFeeRate = parseNumber(row['月費率'], { blankAsZero: true })

    if (
      !Number.isInteger(fromMonth) ||
      !Number.isInteger(toMonth) ||
      fromMonth < 1 ||
      toMonth < fromMonth
    ) {
      errors.push(`費用設定第 ${row.__rowNumber} 列：月份範圍必須為有效正整數`)
    }
    if (!(monthlyFeeRate >= 0)) {
      errors.push(`費用設定第 ${row.__rowNumber} 列：月費率不可為負數`)
    }
    if (!feePlansById.has(feePlanId)) {
      feePlansById.set(feePlanId, { id: feePlanId, name: feePlanName, periods: [] })
    }
    feePlansById.get(feePlanId).periods.push({
      fromMonth,
      toMonth,
      monthlyFeeRate,
    })
  }

  return {
    errors,
    data: {
      assets: {
        dataStatus: 'Excel 設定資料（備援值含測試資料）',
        sourceWorkbook: workbookName,
        assets,
      },
      plans: { defaultProjectId: plans[0]?.id ?? null, plans },
      exchangeRates: {
        staleAfterDays: 7,
        sourceWorkbook: workbookName,
        rates,
      },
      feePlans: { feePlans: [...feePlansById.values()] },
    },
  }
}

async function writeJsonFiles(data) {
  await fs.mkdir(outputDirectory, { recursive: true })
  const generatedAt = new Date().toISOString()
  const files = [
    ['assets.json', { generatedAt, ...data.assets }],
    ['assets-config.json', { generatedAt, ...data.assets }],
    ['plans.json', { generatedAt, ...data.plans }],
    ['exchange-rates.json', { generatedAt, ...data.exchangeRates }],
    ['fee-plans.json', { generatedAt, ...data.feePlans }],
  ]
  for (const [filename, payload] of files) {
    const finalPath = path.join(outputDirectory, filename)
    const temporaryPath = `${finalPath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, finalPath)
  }
}

async function main() {
  const workbook = XLSX.readFile(inputPath, { cellDates: true })
  const { errors, data } = validateAndTransform(workbook)
  if (errors.length) {
    console.error('Excel 資料驗證失敗，未產生任何 JSON：')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }

  await writeJsonFiles(data)
  console.log(
    `Excel 資料驗證成功：${data.plans.plans.length} 個專案、` +
      `${data.assets.assets.length} 個標的、${data.exchangeRates.rates.length} 筆匯率、` +
      `${data.feePlans.feePlans.length} 種費用方案。`,
  )
  console.log(`JSON 已更新：${outputDirectory}`)
}

main().catch((error) => {
  console.error(`Excel 匯入失敗：${error.message}`)
  process.exitCode = 1
})
