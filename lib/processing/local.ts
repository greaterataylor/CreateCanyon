import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, promises as fs } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

export type VirusScanResult = {
  clean: boolean
  engine: string
  signature?: string
  rawOutput?: string
}

export type LocalArtifact = {
  filePath: string
  contentType: string
  extension: string
  metadata?: Record<string, unknown>
}

export type FontPreviewArtifacts = {
  fontFile: LocalArtifact
  specimenImage?: LocalArtifact
}

type CommandSpec = {
  command: string
  prefixArgs?: string[]
}

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

const FONT_SAMPLE_TEXT = [
  'Sphinx of black quartz, judge my vow.',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz 0123456789',
].join('\n')

const commandCache = new Map<string, Promise<CommandSpec | null>>()

function envNumber(name: string, fallback: number) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function trimTo(text: string, max = 4000) {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveExecutable(cacheKey: string, envVar: string | undefined, candidates: CommandSpec[]) {
  if (!commandCache.has(cacheKey)) {
    commandCache.set(cacheKey, (async () => {
      if (envVar) {
        const envPath = envVar.trim()
        if (envPath) return { command: envPath, prefixArgs: [] }
      }
      for (const candidate of candidates) {
        if (candidate.command.includes(path.sep) || candidate.command.startsWith('.')) {
          if (await fileExists(candidate.command)) return { command: candidate.command, prefixArgs: candidate.prefixArgs || [] }
          continue
        }
        const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
        for (const entry of pathEntries) {
          const full = path.join(entry, candidate.command)
          if (await fileExists(full)) return { command: full, prefixArgs: candidate.prefixArgs || [] }
        }
      }
      return null
    })())
  }
  return commandCache.get(cacheKey)!
}

async function runCommand(spec: CommandSpec, args: string[], options?: { cwd?: string; input?: Buffer | string; allowExitCodes?: number[]; timeoutMs?: number }) {
  const allowExitCodes = options?.allowExitCodes || [0]
  const timeoutMs = options?.timeoutMs || envNumber('PROCESSOR_COMMAND_TIMEOUT_MS', 5 * 60 * 1000)
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(spec.command, [...(spec.prefixArgs || []), ...args], {
      cwd: options?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${[spec.command, ...(spec.prefixArgs || []), ...args].join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const result = {
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: exitCode ?? -1,
      }
      if (!allowExitCodes.includes(result.exitCode)) {
        reject(new Error(trimTo(`Command failed (${result.exitCode}): ${[spec.command, ...(spec.prefixArgs || []), ...args].join(' ')}\n${result.stderr || result.stdout}`)))
        return
      }
      resolve(result)
    })

    if (options?.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function extFrom(fileNameOrPath: string | null | undefined) {
  return path.extname(fileNameOrPath || '').toLowerCase()
}

function basename(fileNameOrPath: string | null | undefined) {
  return path.basename(fileNameOrPath || '')
}

function rationalToNumber(value: string | null | undefined) {
  if (!value) return null
  if (!value.includes('/')) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const [numerator, denominator] = value.split('/').map((piece) => Number(piece))
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

function toMaybeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')) as T
}

function normalizeMimeType(mimeType?: string | null) {
  return String(mimeType || '').trim().toLowerCase()
}

function isImageFile(mimeType?: string | null, fileName?: string | null) {
  const mime = normalizeMimeType(mimeType)
  const extension = extFrom(fileName)
  return mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'].includes(extension)
}

function isPdfFile(mimeType?: string | null, fileName?: string | null) {
  const mime = normalizeMimeType(mimeType)
  const extension = extFrom(fileName)
  return mime === 'application/pdf' || extension === '.pdf'
}

function isAudioFile(mimeType?: string | null, fileName?: string | null) {
  const mime = normalizeMimeType(mimeType)
  const extension = extFrom(fileName)
  return mime.startsWith('audio/') || ['.mp3', '.wav', '.aif', '.aiff', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus'].includes(extension)
}

function isVideoFile(mimeType?: string | null, fileName?: string | null) {
  const mime = normalizeMimeType(mimeType)
  const extension = extFrom(fileName)
  return mime.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.mpeg', '.mpg', '.wmv'].includes(extension)
}

function isFontFile(mimeType?: string | null, fileName?: string | null) {
  const mime = normalizeMimeType(mimeType)
  const extension = extFrom(fileName)
  return mime.startsWith('font/') || (['application/vnd.ms-fontobject', 'application/font-sfnt', 'application/octet-stream'].includes(mime) && ['.eot', '.ttf', '.otf', '.woff', '.woff2'].includes(extension)) || ['.ttf', '.otf', '.woff', '.woff2', '.eot'].includes(extension)
}

async function sha256File(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function tmpOutputDir(prefix: string) {
  return await fs.mkdtemp(path.join(tmpdir(), `${prefix}-${randomUUID()}-`))
}

function parseKeyValueLines(output: string) {
  const pairs = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':')
      if (separator === -1) return null
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const
    })
    .filter(Boolean) as Array<readonly [string, string]>
  return Object.fromEntries(pairs)
}

async function getFfmpeg() {
  const command = await resolveExecutable('ffmpeg', process.env.FFMPEG_PATH, [{ command: 'ffmpeg' }])
  if (!command) throw new Error('FFmpeg is required but was not found. Set FFMPEG_PATH or install ffmpeg on the worker host.')
  return command
}

async function getFfprobe() {
  const command = await resolveExecutable('ffprobe', process.env.FFPROBE_PATH, [{ command: 'ffprobe' }])
  if (!command) throw new Error('FFprobe is required but was not found. Set FFPROBE_PATH or install ffprobe on the worker host.')
  return command
}

async function getConvert() {
  const command = await resolveExecutable('imagemagick-convert', process.env.IMAGEMAGICK_CONVERT_PATH, [{ command: 'convert' }, { command: 'magick', prefixArgs: ['convert'] }])
  if (!command) throw new Error('ImageMagick convert is required but was not found. Set IMAGEMAGICK_CONVERT_PATH or install ImageMagick on the worker host.')
  return command
}

async function getIdentify() {
  const command = await resolveExecutable('imagemagick-identify', process.env.IMAGEMAGICK_IDENTIFY_PATH, [{ command: 'identify' }, { command: 'magick', prefixArgs: ['identify'] }])
  if (!command) throw new Error('ImageMagick identify is required but was not found. Set IMAGEMAGICK_IDENTIFY_PATH or install ImageMagick on the worker host.')
  return command
}

async function getPdfToPpm() {
  const command = await resolveExecutable('pdftoppm', process.env.PDFTOPPM_PATH, [{ command: 'pdftoppm' }])
  if (!command) throw new Error('pdftoppm is required but was not found. Set PDFTOPPM_PATH or install poppler-utils on the worker host.')
  return command
}

async function getPdfInfo() {
  const command = await resolveExecutable('pdfinfo', process.env.PDFINFO_PATH, [{ command: 'pdfinfo' }])
  if (!command) throw new Error('pdfinfo is required but was not found. Set PDFINFO_PATH or install poppler-utils on the worker host.')
  return command
}

async function getFcScan() {
  return await resolveExecutable('fc-scan', process.env.FCSCAN_PATH || process.env.FC_SCAN_PATH, [{ command: 'fc-scan' }])
}

async function getOtfInfo() {
  return await resolveExecutable('otfinfo', process.env.OTFINFO_PATH, [{ command: 'otfinfo' }])
}

async function getPyftsubset() {
  return await resolveExecutable('pyftsubset', process.env.PYFTSUBSET_PATH, [{ command: 'pyftsubset' }])
}

async function getClamScan() {
  return await resolveExecutable('clamscan', process.env.CLAMSCAN_PATH, [{ command: 'clamscan' }])
}

async function identifyImage(filePath: string) {
  const identify = await getIdentify()
  const { stdout } = await runCommand(identify, ['-ping', '-format', '%m|%w|%h|%[colorspace]|%[orientation]', `${filePath}[0]`])
  const [format, width, height, colorSpace, orientation] = stdout.trim().split('|')
  return cleanObject({
    imageFormat: format || null,
    mediaWidth: toMaybeNumber(width),
    mediaHeight: toMaybeNumber(height),
    imageColorSpace: colorSpace || null,
    imageOrientation: orientation || null,
  })
}

async function ffprobeMedia(filePath: string) {
  const ffprobe = await getFfprobe()
  const { stdout } = await runCommand(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath])
  const json = JSON.parse(stdout || '{}') as {
    format?: { duration?: string; bit_rate?: string; format_name?: string; tags?: Record<string, string> }
    streams?: Array<Record<string, unknown>>
  }
  const streams = Array.isArray(json.streams) ? json.streams : []
  const audioStream = streams.find((stream) => String(stream.codec_type || '').toLowerCase() === 'audio') || null
  const videoStream = streams.find((stream) => String(stream.codec_type || '').toLowerCase() === 'video') || null
  return cleanObject({
    mediaContainer: json.format?.format_name || null,
    mediaDurationSeconds: toMaybeNumber(json.format?.duration),
    mediaBitRate: toMaybeNumber(json.format?.bit_rate),
    mediaAudioCodec: audioStream ? String(audioStream.codec_name || '') || null : null,
    mediaVideoCodec: videoStream ? String(videoStream.codec_name || '') || null : null,
    mediaSampleRate: audioStream ? toMaybeNumber(audioStream.sample_rate) : null,
    mediaChannels: audioStream ? toMaybeNumber(audioStream.channels) : null,
    mediaWidth: videoStream ? toMaybeNumber(videoStream.width) : null,
    mediaHeight: videoStream ? toMaybeNumber(videoStream.height) : null,
    mediaFrameRate: videoStream ? rationalToNumber(String(videoStream.avg_frame_rate || videoStream.r_frame_rate || '')) : null,
  })
}

async function pdfMetadata(filePath: string) {
  const pdfinfo = await getPdfInfo()
  const { stdout } = await runCommand(pdfinfo, [filePath])
  const fields = parseKeyValueLines(stdout)
  return cleanObject({
    pdfPageCount: toMaybeNumber(fields.Pages),
    pdfVersion: fields['PDF version'] || null,
    pdfEncrypted: fields.Encrypted || null,
    pdfPageSizePoints: fields['Page size'] || null,
    pdfTitle: fields.Title || null,
    pdfAuthor: fields.Author || null,
  })
}

async function fontMetadata(filePath: string) {
  const fcScan = await getFcScan()
  if (fcScan) {
    try {
      const { stdout } = await runCommand(fcScan, ['--format', '%{family[0]}|%{style[0]}|%{fullname[0]}|%{fontformat}|%{postscriptname}\n', filePath])
      const [family, style, fullName, format, postscriptName] = stdout.trim().split('|')
      const parsed = cleanObject({
        fontFamily: family || null,
        fontStyle: style || null,
        fontFullName: fullName || null,
        fontFormat: format || null,
        fontPostscriptName: postscriptName || null,
      })
      if (Object.keys(parsed).length) return parsed
    } catch {
    }
  }

  const otfinfo = await getOtfInfo()
  if (otfinfo) {
    const { stdout } = await runCommand(otfinfo, ['-i', filePath])
    const fields = parseKeyValueLines(stdout)
    return cleanObject({
      fontFamily: fields.Family || null,
      fontStyle: fields.Subfamily || null,
      fontFullName: fields['Full name'] || null,
      fontPostscriptName: fields['PostScript name'] || null,
      fontVersion: fields.Version || null,
      fontFormat: fields['Font format'] || null,
    })
  }

  return {}
}

async function scanFileWithClamScan(filePath: string) {
  const clamscan = await getClamScan()
  if (!clamscan) return null
  const result = await runCommand(clamscan, ['--no-summary', filePath], { allowExitCodes: [0, 1], timeoutMs: envNumber('CLAMSCAN_TIMEOUT_MS', 15 * 60 * 1000) })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  if (result.exitCode === 0) {
    return { clean: true, engine: 'clamscan', rawOutput: trimTo(output) } satisfies VirusScanResult
  }
  const match = output.match(/: (.+?) FOUND/m)
  return { clean: false, engine: 'clamscan', signature: match?.[1] || 'unknown-signature', rawOutput: trimTo(output) } satisfies VirusScanResult
}

async function scanFileWithClamd(filePath: string) {
  const host = process.env.CLAMD_HOST || ''
  const port = Number(process.env.CLAMD_PORT || 3310)
  const socketPath = process.env.CLAMD_SOCKET_PATH || ''
  if (!socketPath && !host) return null

  const timeoutMs = envNumber('CLAMD_TIMEOUT_MS', 15 * 60 * 1000)
  const response = await new Promise<string>((resolve, reject) => {
    const socket = socketPath ? net.createConnection(socketPath) : net.createConnection({ host, port })
    let done = false
    const chunks: Buffer[] = []

    const finish = (error?: Error | null, value?: string) => {
      if (done) return
      done = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value || '')
    }

    socket.setTimeout(timeoutMs, () => finish(new Error('Timed out talking to clamd.')))
    socket.on('error', (error) => finish(error))
    socket.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    socket.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8').trim()))
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 })
      stream.on('error', (error) => finish(error))
      stream.on('data', (chunk) => {
        const size = Buffer.allocUnsafe(4)
        size.writeUInt32BE(chunk.length, 0)
        socket.write(size)
        socket.write(chunk)
      })
      stream.on('end', () => {
        const trailer = Buffer.allocUnsafe(4)
        trailer.writeUInt32BE(0, 0)
        socket.write(trailer)
      })
    })
  })

  if (/\bOK\b/i.test(response)) return { clean: true, engine: 'clamd', rawOutput: trimTo(response) } satisfies VirusScanResult
  const match = response.match(/: (.+?) FOUND/i)
  return { clean: false, engine: 'clamd', signature: match?.[1] || 'unknown-signature', rawOutput: trimTo(response) } satisfies VirusScanResult
}

export async function scanFileForViruses(filePath: string): Promise<VirusScanResult> {
  const viaBinary = await scanFileWithClamScan(filePath)
  if (viaBinary) return viaBinary
  const viaDaemon = await scanFileWithClamd(filePath)
  if (viaDaemon) return viaDaemon
  throw new Error('Virus scan processor is configured, but no ClamAV scanner was found. Install clamscan or configure CLAMD_HOST/CLAMD_PORT (or CLAMD_SOCKET_PATH).')
}

export async function extractFileMetadata(filePath: string, input?: { mimeType?: string | null; originalFilename?: string | null }) {
  const mimeType = normalizeMimeType(input?.mimeType)
  const originalFilename = input?.originalFilename || basename(filePath)
  const extension = extFrom(originalFilename || filePath)
  const stat = await fs.stat(filePath)
  const metadata: Record<string, unknown> = {
    sourceFilename: originalFilename,
    sourceExtension: extension.replace(/^\./, '') || null,
    sourceMimeType: mimeType || null,
    sourceSizeBytes: stat.size,
    sourceSha256: await sha256File(filePath),
  }

  if (isAudioFile(mimeType, originalFilename) || isVideoFile(mimeType, originalFilename)) {
    try {
      Object.assign(metadata, await ffprobeMedia(filePath))
    } catch {
    }
  }

  if (isImageFile(mimeType, originalFilename)) {
    try {
      Object.assign(metadata, await identifyImage(filePath))
    } catch {
    }
  }

  if (isPdfFile(mimeType, originalFilename)) {
    try {
      Object.assign(metadata, await pdfMetadata(filePath))
    } catch {
    }
  }

  if (isFontFile(mimeType, originalFilename)) {
    try {
      Object.assign(metadata, await fontMetadata(filePath))
    } catch {
    }
  }

  return cleanObject(metadata)
}

export async function generateImageThumbnail(filePath: string, outputDir?: string): Promise<LocalArtifact> {
  const convert = await getConvert()
  const targetDir = outputDir || await tmpOutputDir('createcanyon-image-thumb')
  const outputPath = path.join(targetDir, 'thumbnail.jpg')
  await runCommand(convert, [
    `${filePath}[0]`,
    '-auto-orient',
    '-thumbnail', '1600x1600>',
    '-strip',
    '-quality', String(envNumber('IMAGE_THUMBNAIL_QUALITY', 90)),
    outputPath,
  ])
  const metadata = await identifyImage(outputPath).catch(() => ({}))
  return { filePath: outputPath, contentType: 'image/jpeg', extension: '.jpg', metadata }
}

export async function generatePdfThumbnail(filePath: string, outputDir?: string): Promise<LocalArtifact> {
  const targetDir = outputDir || await tmpOutputDir('createcanyon-pdf-thumb')
  const outputBase = path.join(targetDir, 'thumbnail')
  const outputPath = `${outputBase}.jpg`
  try {
    const pdftoppm = await getPdfToPpm()
    await runCommand(pdftoppm, ['-jpeg', '-jpegopt', `quality=${envNumber('PDF_THUMBNAIL_QUALITY', 90)}`, '-f', '1', '-singlefile', '-scale-to', String(envNumber('PDF_THUMBNAIL_SIZE', 1600)), filePath, outputBase])
  } catch {
    const convert = await getConvert()
    await runCommand(convert, [`${filePath}[0]`, '-thumbnail', '1600x1600>', '-strip', '-quality', String(envNumber('PDF_THUMBNAIL_QUALITY', 90)), outputPath])
  }
  const metadata = await identifyImage(outputPath).catch(() => ({}))
  return { filePath: outputPath, contentType: 'image/jpeg', extension: '.jpg', metadata }
}

export async function generateAudioWaveform(filePath: string, outputDir?: string): Promise<LocalArtifact> {
  const ffmpeg = await getFfmpeg()
  const targetDir = outputDir || await tmpOutputDir('createcanyon-waveform')
  const outputPath = path.join(targetDir, 'waveform.png')
  await runCommand(ffmpeg, [
    '-y',
    '-i', filePath,
    '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1600x320',
    '-frames:v', '1',
    outputPath,
  ])
  const metadata = await identifyImage(outputPath).catch(() => ({}))
  return { filePath: outputPath, contentType: 'image/png', extension: '.png', metadata }
}

export async function transcodeAudioPreview(filePath: string, outputDir?: string): Promise<LocalArtifact> {
  const ffmpeg = await getFfmpeg()
  const targetDir = outputDir || await tmpOutputDir('createcanyon-audio-preview')
  const outputPath = path.join(targetDir, 'preview.mp3')
  await runCommand(ffmpeg, [
    '-y',
    '-i', filePath,
    '-vn',
    '-t', String(envNumber('AUDIO_PREVIEW_DURATION_SECONDS', 90)),
    '-ac', '2',
    '-ar', '44100',
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    outputPath,
  ])
  const metadata = await ffprobeMedia(outputPath).catch(() => ({}))
  return { filePath: outputPath, contentType: 'audio/mpeg', extension: '.mp3', metadata }
}

export async function transcodeVideoPreview(filePath: string, outputDir?: string): Promise<LocalArtifact> {
  const ffmpeg = await getFfmpeg()
  const targetDir = outputDir || await tmpOutputDir('createcanyon-video-preview')
  const outputPath = path.join(targetDir, 'preview.mp4')
  await runCommand(ffmpeg, [
    '-y',
    '-i', filePath,
    '-t', String(envNumber('VIDEO_PREVIEW_DURATION_SECONDS', 60)),
    '-vf', "scale=w='trunc(min(1280,iw)/2)*2':h='trunc(min(720,ih)/2)*2':force_original_aspect_ratio=decrease",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ], { timeoutMs: envNumber('VIDEO_TRANSCODE_TIMEOUT_MS', 30 * 60 * 1000) })
  const metadata = await ffprobeMedia(outputPath).catch(() => ({}))
  return { filePath: outputPath, contentType: 'video/mp4', extension: '.mp4', metadata }
}

async function prepareWebPreviewFont(filePath: string, outputDir: string) {
  const extension = extFrom(filePath)
  const pyftsubset = await getPyftsubset()
  if (pyftsubset) {
    try {
      const subsetPath = path.join(outputDir, 'preview-font.woff2')
      await runCommand(pyftsubset, [
        filePath,
        `--output-file=${subsetPath}`,
        '--flavor=woff2',
        `--text=${FONT_SAMPLE_TEXT}`,
        '--layout-features=*',
        '--name-IDs=*',
        '--glyph-names',
        '--symbol-cmap',
        '--legacy-cmap',
        '--notdef-glyph',
        '--notdef-outline',
        '--recommended-glyphs',
      ], { timeoutMs: envNumber('FONT_SUBSET_TIMEOUT_MS', 10 * 60 * 1000) })
      return { filePath: subsetPath, contentType: 'font/woff2', extension: '.woff2' }
    } catch {
    }
  }

  const copiedExtension = extension || '.ttf'
  const copiedPath = path.join(outputDir, `preview-font${copiedExtension}`)
  await fs.copyFile(filePath, copiedPath)
  const contentType = copiedExtension === '.woff2'
    ? 'font/woff2'
    : copiedExtension === '.woff'
      ? 'font/woff'
      : copiedExtension === '.otf'
        ? 'font/otf'
        : copiedExtension === '.eot'
          ? 'application/vnd.ms-fontobject'
          : 'font/ttf'
  return { filePath: copiedPath, contentType, extension: copiedExtension }
}

async function renderFontSpecimen(filePath: string, outputDir: string) {
  const convert = await getConvert()
  const outputPath = path.join(outputDir, 'specimen.png')
  await runCommand(convert, [
    '-background', 'white',
    '-fill', 'black',
    '-font', filePath,
    '-size', '1600x900',
    'caption:' + FONT_SAMPLE_TEXT,
    outputPath,
  ])
  const metadata = await identifyImage(outputPath).catch(() => ({}))
  return { filePath: outputPath, contentType: 'image/png', extension: '.png', metadata }
}

export async function generateFontPreviewArtifacts(filePath: string, outputDir?: string): Promise<FontPreviewArtifacts> {
  const targetDir = outputDir || await tmpOutputDir('createcanyon-font-preview')
  const fontFile = await prepareWebPreviewFont(filePath, targetDir)
  let specimenImage: LocalArtifact | undefined
  try {
    specimenImage = await renderFontSpecimen(filePath, targetDir)
  } catch {
    specimenImage = undefined
  }
  return { fontFile, specimenImage }
}
