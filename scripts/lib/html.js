import iconv from 'iconv-lite'

const defaultHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
}

function normalizeCharset(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('"', '')
    .replaceAll("'", '')
  if (['utf8', 'utf-8'].includes(normalized)) return 'utf8'
  if (['big5', 'big-5', 'big5-hkscs'].includes(normalized)) return 'big5'
  if (['cp950', 'windows-950', 'ms950'].includes(normalized)) return 'cp950'
  return normalized
}

function charsetFromHeader(contentType) {
  return normalizeCharset(
    String(contentType ?? '').match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1],
  )
}

function charsetFromMeta(buffer) {
  const beginning = buffer.subarray(0, 8192).toString('latin1')
  const direct = beginning.match(
    /<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>;]+)/i,
  )?.[1]
  if (direct) return normalizeCharset(direct)
  return normalizeCharset(
    beginning.match(
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"'\s;]+)/i,
    )?.[1],
  )
}

function decodedTextScore(text, expectChinese) {
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length
  const mojibakeCount = (text.match(/(?:Ã.|Â.|â€|ï¿½|�)/g) ?? []).length
  const hasChinese = /[\u3400-\u9fff]/.test(text)
  const missingChinesePenalty = expectChinese && !hasChinese ? 100000 : 0
  return replacementCount * 100 + mojibakeCount * 40 + missingChinesePenalty
}

function hasReadableChinese(text) {
  if (!/[\u3400-\u9fff]/.test(text)) return false
  if ((text.match(/\uFFFD/g) ?? []).length > 2) return false
  return !/(?:Ã.|Â.|â€|ï¿½)/.test(text)
}

export async function downloadDecodedText(
  url,
  { expectChinese = true, timeoutMs = 20000 } = {},
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      headers: defaultHeaders,
      redirect: 'follow',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const headerCharset = charsetFromHeader(response.headers.get('content-type'))
  const metaCharset = charsetFromMeta(buffer)
  const candidates = [
    headerCharset,
    metaCharset,
    'utf8',
    'big5',
    'cp950',
  ].filter(
    (encoding, index, all) =>
      encoding &&
      iconv.encodingExists(encoding) &&
      all.indexOf(encoding) === index,
  )

  const decoded = candidates
    .map((encoding) => ({
      encoding,
      text: iconv.decode(buffer, encoding),
    }))
    .map((candidate) => ({
      ...candidate,
      score: decodedTextScore(candidate.text, expectChinese),
    }))
    .sort((a, b) => a.score - b.score)[0]

  if (!decoded) throw new Error('找不到可用的網頁編碼')
  if (expectChinese && !hasReadableChinese(decoded.text)) {
    throw new Error('中文內容解碼後仍無法辨識')
  }

  return {
    text: decoded.text,
    encoding: decoded.encoding,
    finalUrl: response.url,
    contentType: response.headers.get('content-type'),
  }
}
