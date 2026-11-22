import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { getModelConfig, generate, RequestError, validateGeneration } from './agent.mjs'

const config = getModelConfig()
const host = '127.0.0.1'
const port = Number(process.env.WORKBENCH_PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('WORKBENCH_PORT 需要一个 1 到 65535 之间的端口号。')
}

const maxBody = 256 * 1024
const maxPending = 2
const mediaTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
  ['.ico', 'image/vnd.microsoft.icon'],
])
const defaultHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}

let pending = 0

function reply(response, status, type, body, head = false) {
  response.writeHead(status, {
    ...defaultHeaders,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(head ? undefined : body)
}

function json(response, status, data) {
  reply(response, status, 'application/json; charset=utf-8', JSON.stringify(data))
}

function checkHost(request) {
  const hostname = request.headers.host
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/i.test(hostname ?? '')) {
    throw new RequestError(403, '请从本机地址打开工作台。')
  }
  const origin = request.headers.origin
  if (origin && origin !== 'http://' + hostname.toLowerCase()) {
    throw new RequestError(403, '请求来源与工作台地址不一致。')
  }
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, '请求需要使用 JSON 格式。')
  }
  if (Number(request.headers['content-length']) > maxBody) {
    throw new RequestError(413, '提交的资料超出长度限制。')
  }

  const chunks = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.byteLength
    if (size > maxBody) throw new RequestError(413, '提交的资料超出长度限制。')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, '无法读取请求中的 JSON。')
  }
}

async function serveAsset(request, response, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname
  const type = mediaTypes.get(extname(file))
  if (!type || !/^\/[a-z0-9][a-z0-9_-]*\.[a-z0-9]+$/i.test(file)) {
    throw new RequestError(404, '找不到这个页面。')
  }

  const asset = new URL('./public' + file, import.meta.url)
  const body = await readFile(asset).catch(error => {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new RequestError(404, '找不到这个页面。')
    throw error
  })
  reply(response, 200, type, body, request.method === 'HEAD')
}

async function handle(request, response) {
  checkHost(request)
  const pathname = request.url.split('?', 1)[0]
  if (pathname === '/api/status' && request.method === 'GET') {
    json(response, 200, { configured: config !== null })
    return
  }

  if (pathname === '/api/generate' && request.method === 'POST') {
    const generation = validateGeneration(await readJson(request))
    if (!config) throw new RequestError(503, '请在服务启动环境中配置模型地址、密钥和模型名称。')
    if (pending >= maxPending) throw new RequestError(429, '当前正在处理其他任务，请稍后再试。')

    pending += 1
    const client = new AbortController()
    response.once('close', () => {
      if (!response.writableFinished) client.abort()
    })
    try {
      const result = await generate(config, generation, client.signal)
      if (!response.destroyed) json(response, 200, result)
    } finally {
      pending -= 1
    }
    return
  }

  if (pathname === '/api/status' || pathname === '/api/generate') {
    throw new RequestError(405, '此接口不支持当前请求方法。')
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    await serveAsset(request, response, pathname)
    return
  }
  throw new RequestError(404, '找不到这个页面。')
}

const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (request, response) => {
  handle(request, response).catch(error => {
    request.resume()
    if (response.destroyed) return
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message })
      return
    }
    console.error(error)
    json(response, 500, { error: '工作台遇到意外错误，请重试。' })
  })
})

server.listen(port, host, () => console.log('工作台已启动 http://' + host + ':' + port))
