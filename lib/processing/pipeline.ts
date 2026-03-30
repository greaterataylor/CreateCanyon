import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createAuditLog } from '../audit'
import { prisma } from '../prisma'
import { bucketForPurpose, publicObjectUrl, s3 } from '../s3'
import {
  extractFileMetadata,
  generateAudioWaveform,
  generateFontPreviewArtifacts,
  generateImageThumbnail,
  generatePdfThumbnail,
  LocalArtifact,
  scanFileForViruses,
  transcodeAudioPreview,
  transcodeVideoPreview,
} from './local'

type SourceFile = {
  bucket: string
  storageKey: string
  mimeType: string
  originalFilename: string
  sizeBytes?: number | null
}

type ProcessingOutcome = {
  processed: boolean
  status: 'completed' | 'failed' | 'skipped'
}

function truncate(text: string, max = 4000) {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function extForStorageKey(storageKey: string) {
  return path.extname(storageKey || '').toLowerCase()
}

function normalizeMimeType(mimeType?: string | null) {
  return String(mimeType || '').trim().toLowerCase()
}

function fileMatchesKind(file: { mimeType?: string | null; originalFilename?: string | null; storageKey?: string | null }, kind: 'image' | 'pdf' | 'audio' | 'video' | 'font') {
  const mimeType = normalizeMimeType(file.mimeType)
  const fileName = file.originalFilename || file.storageKey || ''
  const extension = extForStorageKey(fileName)
  if (kind === 'image') return mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'].includes(extension)
  if (kind === 'pdf') return mimeType === 'application/pdf' || extension === '.pdf'
  if (kind === 'audio') return mimeType.startsWith('audio/') || ['.mp3', '.wav', '.aif', '.aiff', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus'].includes(extension)
  if (kind === 'video') return mimeType.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.mpeg', '.mpg', '.wmv'].includes(extension)
  return mimeType.startsWith('font/') || ['application/vnd.ms-fontobject', 'application/font-sfnt'].includes(mimeType) || ['.ttf', '.otf', '.woff', '.woff2', '.eot'].includes(extension)
}

function derivedStorageKey(job: any, role: string, extension: string) {
  const safeExtension = extension.startsWith('.') ? extension.slice(1) : extension
  return `derived/${job.siteId}/${job.assetId}/${job.versionId || 'current'}/${role}.${safeExtension}`
}

async function claimJob(jobId: string) {
  const result = await prisma.processingJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: {
      status: 'PROCESSING',
      attempts: { increment: 1 },
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
    },
  })
  return result.count === 1
}

async function setJobState(jobId: string, status: 'COMPLETED' | 'FAILED', lastError?: string | null) {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status,
      finishedAt: new Date(),
      lastError: lastError === undefined ? undefined : lastError,
    },
  }).catch(() => null)
}

async function loadJob(jobId: string) {
  return await prisma.processingJob.findUnique({
    where: { id: jobId },
    include: {
      version: { include: { files: true } },
      asset: {
        include: {
          files: true,
          previews: { orderBy: { sortOrder: 'asc' } },
          versions: { where: { isCurrent: true }, take: 1, orderBy: { createdAt: 'desc' }, include: { files: true } },
        },
      },
    },
  })
}

function currentVersion(job: any) {
  return job.version || job.asset?.versions?.[0] || null
}

function currentDownloadFile(job: any) {
  const version = currentVersion(job)
  if (version?.files?.length) {
    return version.files.find((file: any) => file.kind === 'download') || version.files[0]
  }
  if (job.asset?.primaryDownloadKey) {
    const exact = job.asset.files?.find((file: any) => file.storageKey === job.asset.primaryDownloadKey)
    if (exact) return exact
  }
  return job.asset?.files?.find((file: any) => file.kind === 'download') || job.asset?.files?.[0] || null
}

function previewAssetFile(job: any, expectedKind: 'image' | 'pdf' | 'audio' | 'video' | 'font') {
  if (job.versionId) return null
  const file = job.asset?.files?.find((candidate: any) => candidate.kind === 'preview' && fileMatchesKind(candidate, expectedKind))
  if (file) return file
  const preview = job.asset?.previews?.find((candidate: any) => fileMatchesKind(candidate, expectedKind) && candidate.storageKey)
  if (!preview) return null
  return {
    storageBucket: bucketForPurpose('preview'),
    storageKey: preview.storageKey,
    originalFilename: path.basename(preview.storageKey || `preview-${expectedKind}`),
    mimeType: preview.mimeType || '',
    sizeBytes: null,
  }
}

function sourceForVirusAndMetadata(job: any): SourceFile {
  const file = currentDownloadFile(job)
  if (!file) throw new Error('No download file was found for this asset version.')
  return {
    bucket: file.storageBucket,
    storageKey: file.storageKey,
    mimeType: file.mimeType,
    originalFilename: file.originalFilename,
    sizeBytes: file.sizeBytes,
  }
}

function preferredSource(job: any, kind: 'image' | 'pdf' | 'audio' | 'video' | 'font'): SourceFile {
  const preview = previewAssetFile(job, kind)
  if (preview) {
    return {
      bucket: preview.storageBucket,
      storageKey: preview.storageKey,
      mimeType: preview.mimeType,
      originalFilename: preview.originalFilename,
      sizeBytes: preview.sizeBytes,
    }
  }
  const download = currentDownloadFile(job)
  if (!download) throw new Error(`No source file available for ${kind} processor.`)
  return {
    bucket: download.storageBucket,
    storageKey: download.storageKey,
    mimeType: download.mimeType,
    originalFilename: download.originalFilename,
    sizeBytes: download.sizeBytes,
  }
}

async function writeBodyToFile(body: any, targetPath: string) {
  if (!body) throw new Error('S3 response did not include a body stream.')
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray()
    await fs.writeFile(targetPath, Buffer.from(bytes))
    return
  }
  if (typeof body.transformToWebStream === 'function') {
    await pipeline(Readable.fromWeb(body.transformToWebStream()), createWriteStream(targetPath))
    return
  }
  if (typeof body.pipe === 'function') {
    await pipeline(body, createWriteStream(targetPath))
    return
  }
  throw new Error('Unsupported S3 body stream type.')
}

async function downloadToTemp(source: SourceFile, tempDir: string) {
  const extension = extForStorageKey(source.originalFilename || source.storageKey) || extForStorageKey(source.storageKey) || ''
  const localPath = path.join(tempDir, `source${extension}`)
  const response = await s3.send(new GetObjectCommand({ Bucket: source.bucket, Key: source.storageKey }))
  await writeBodyToFile((response as any).Body, localPath)
  return localPath
}

async function uploadArtifact(job: any, role: string, artifact: LocalArtifact) {
  const previewBucket = bucketForPurpose('preview')
  if (!previewBucket) throw new Error('S3_PUBLIC_BUCKET is not configured for derived previews.')
  const storageKey = derivedStorageKey(job, role, artifact.extension)
  await s3.send(new PutObjectCommand({
    Bucket: previewBucket,
    Key: storageKey,
    Body: createReadStream(artifact.filePath),
    ContentType: artifact.contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return { storageKey, url: publicObjectUrl(storageKey), mimeType: artifact.contentType }
}

async function mergeAssetMetadata(assetId: string, patch: Record<string, unknown>) {
  const current = await prisma.asset.findUnique({ where: { id: assetId }, select: { metadata: true } })
  const next = { ...asRecord(current?.metadata), ...patch }
  await prisma.asset.update({ where: { id: assetId }, data: { metadata: next as any } })
}

async function upsertPreview(input: {
  assetId: string
  role: string
  type: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'PDF' | 'FONT'
  url: string
  storageKey: string
  mimeType: string
  sortOrder: number
  metadata?: Record<string, unknown>
  makePrimary?: boolean
}) {
  const previews = await prisma.assetPreview.findMany({ where: { assetId: input.assetId }, orderBy: { sortOrder: 'asc' } })
  const existing = previews.find((preview: any) => preview.storageKey === input.storageKey || asRecord(preview.metadata).role === input.role)

  if (input.makePrimary || input.sortOrder === 0) {
    const toDemote = previews.filter((preview: any) => preview.id !== existing?.id && preview.sortOrder === 0)
    for (const [index, preview] of toDemote.entries()) {
      await prisma.assetPreview.update({ where: { id: preview.id }, data: { sortOrder: 20 + index } })
    }
  }

  const data = {
    type: input.type,
    url: input.url,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    sortOrder: input.sortOrder,
    metadata: { ...(existing ? asRecord(existing.metadata) : {}), ...(input.metadata || {}), role: input.role, derived: true } as any,
  }

  if (existing) await prisma.assetPreview.update({ where: { id: existing.id }, data })
  else await prisma.assetPreview.create({ data: { assetId: input.assetId, ...data } })

  if (input.makePrimary || input.sortOrder === 0) {
    await prisma.asset.update({ where: { id: input.assetId }, data: { previewUrl: input.url } })
  }
}

async function recordChecksum(assetId: string, storageKey: string, checksum: string) {
  await prisma.assetFile.updateMany({ where: { assetId, storageKey }, data: { checksum } }).catch(() => null)
}

async function failSiblingJobs(job: any, reason: string) {
  await prisma.processingJob.updateMany({
    where: { assetId: job.assetId, id: { not: job.id }, status: 'QUEUED' },
    data: { status: 'FAILED', lastError: reason, finishedAt: new Date() },
  }).catch(() => null)
}

async function handleVirusScan(job: any, tempDir: string) {
  const source = sourceForVirusAndMetadata(job)
  const localPath = await downloadToTemp(source, tempDir)
  const result = await scanFileForViruses(localPath)
  await mergeAssetMetadata(job.assetId, {
    virusScanStatus: result.clean ? 'clean' : 'infected',
    virusScanEngine: result.engine,
    virusScannedAt: new Date().toISOString(),
    ...(result.signature ? { virusSignature: result.signature } : {}),
  })

  if (!result.clean) {
    const complianceNotes = [
      'Malware detected during background virus scan.',
      `Engine: ${result.engine}`,
      result.signature ? `Signature: ${result.signature}` : null,
      result.rawOutput ? `Scanner output: ${truncate(result.rawOutput, 1000)}` : null,
    ].filter(Boolean).join(' ')

    await prisma.asset.update({
      where: { id: job.assetId },
      data: {
        downloadsDisabled: true,
        status: 'REJECTED',
        rejectionReason: 'Malware detected during virus scan.',
        complianceNotes,
      },
    })
    await failSiblingJobs(job, 'Skipped because virus scan detected malware.')
    await createAuditLog({ siteId: job.siteId, entityType: 'asset', entityId: job.assetId, action: 'asset.virus_scan.infected', details: result })
    return
  }

  await createAuditLog({ siteId: job.siteId, entityType: 'asset', entityId: job.assetId, action: 'asset.virus_scan.clean', details: { engine: result.engine } })
}

async function handleMetadataExtraction(job: any, tempDir: string) {
  const source = sourceForVirusAndMetadata(job)
  const localPath = await downloadToTemp(source, tempDir)
  const metadata = await extractFileMetadata(localPath, { mimeType: source.mimeType, originalFilename: source.originalFilename })
  await mergeAssetMetadata(job.assetId, metadata)
  if (typeof metadata.sourceSha256 === 'string' && metadata.sourceSha256) {
    await recordChecksum(job.assetId, source.storageKey, metadata.sourceSha256)
  }
  await createAuditLog({ siteId: job.siteId, entityType: 'asset', entityId: job.assetId, action: 'asset.metadata.extracted', details: metadata })
}

async function handleImageThumbnail(job: any, tempDir: string) {
  const source = preferredSource(job, 'image')
  const localPath = await downloadToTemp(source, tempDir)
  const artifact = await generateImageThumbnail(localPath, tempDir)
  const uploaded = await uploadArtifact(job, 'image-thumbnail', artifact)
  await upsertPreview({ assetId: job.assetId, role: 'image-thumbnail', type: 'IMAGE', url: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, sortOrder: 0, metadata: artifact.metadata, makePrimary: true })
}

async function handlePdfThumbnail(job: any, tempDir: string) {
  const source = preferredSource(job, 'pdf')
  const localPath = await downloadToTemp(source, tempDir)
  const artifact = await generatePdfThumbnail(localPath, tempDir)
  const uploaded = await uploadArtifact(job, 'pdf-thumbnail', artifact)
  await upsertPreview({ assetId: job.assetId, role: 'pdf-thumbnail', type: 'PDF', url: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, sortOrder: 0, metadata: artifact.metadata, makePrimary: true })
}

async function handleAudioWaveform(job: any, tempDir: string) {
  const source = preferredSource(job, 'audio')
  const localPath = await downloadToTemp(source, tempDir)
  const artifact = await generateAudioWaveform(localPath, tempDir)
  const uploaded = await uploadArtifact(job, 'audio-waveform', artifact)
  await upsertPreview({ assetId: job.assetId, role: 'audio-waveform', type: 'IMAGE', url: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, sortOrder: 10, metadata: artifact.metadata, makePrimary: false })
}

async function handleAudioTranscode(job: any, tempDir: string) {
  const source = preferredSource(job, 'audio')
  const localPath = await downloadToTemp(source, tempDir)
  const artifact = await transcodeAudioPreview(localPath, tempDir)
  const uploaded = await uploadArtifact(job, 'audio-preview', artifact)
  await upsertPreview({ assetId: job.assetId, role: 'audio-preview', type: 'AUDIO', url: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, sortOrder: 0, metadata: artifact.metadata, makePrimary: true })
}

async function handleVideoTranscode(job: any, tempDir: string) {
  const source = preferredSource(job, 'video')
  const localPath = await downloadToTemp(source, tempDir)
  const artifact = await transcodeVideoPreview(localPath, tempDir)
  const uploaded = await uploadArtifact(job, 'video-preview', artifact)
  await upsertPreview({ assetId: job.assetId, role: 'video-preview', type: 'VIDEO', url: uploaded.url, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, sortOrder: 0, metadata: artifact.metadata, makePrimary: true })
}

async function handleFontPreview(job: any, tempDir: string) {
  const source = preferredSource(job, 'font')
  const localPath = await downloadToTemp(source, tempDir)
  const artifacts = await generateFontPreviewArtifacts(localPath, tempDir)
  const fontUpload = await uploadArtifact(job, 'font-preview-font', artifacts.fontFile)
  await upsertPreview({ assetId: job.assetId, role: 'font-preview-font', type: 'FONT', url: fontUpload.url, storageKey: fontUpload.storageKey, mimeType: fontUpload.mimeType, sortOrder: 0, metadata: { sourceMimeType: source.mimeType }, makePrimary: true })
  if (artifacts.specimenImage) {
    const specimenUpload = await uploadArtifact(job, 'font-specimen', artifacts.specimenImage)
    await upsertPreview({ assetId: job.assetId, role: 'font-specimen', type: 'IMAGE', url: specimenUpload.url, storageKey: specimenUpload.storageKey, mimeType: specimenUpload.mimeType, sortOrder: 10, metadata: artifacts.specimenImage.metadata, makePrimary: false })
  }
}

async function processJobByType(job: any, tempDir: string) {
  switch (job.jobType) {
    case 'virus_scan':
      await handleVirusScan(job, tempDir)
      return
    case 'extract_metadata':
      await handleMetadataExtraction(job, tempDir)
      return
    case 'image_thumbnail':
      await handleImageThumbnail(job, tempDir)
      return
    case 'pdf_thumbnail':
      await handlePdfThumbnail(job, tempDir)
      return
    case 'audio_waveform':
      await handleAudioWaveform(job, tempDir)
      return
    case 'audio_transcode':
      await handleAudioTranscode(job, tempDir)
      return
    case 'video_transcode':
      await handleVideoTranscode(job, tempDir)
      return
    case 'font_preview':
      await handleFontPreview(job, tempDir)
      return
    default:
      throw new Error(`Unknown processing job type: ${job.jobType}`)
  }
}

export async function processQueuedJob(jobId: string): Promise<ProcessingOutcome> {
  const claimed = await claimJob(jobId)
  if (!claimed) return { processed: false, status: 'skipped' }

  const job = await loadJob(jobId)
  if (!job) {
    await setJobState(jobId, 'FAILED', 'The queued job could not be loaded.')
    return { processed: true, status: 'failed' }
  }

  const tempDir = path.join(tmpdir(), `createcanyon-${randomUUID()}`)
  await fs.mkdir(tempDir, { recursive: true })

  try {
    await processJobByType(job, tempDir)
    await setJobState(job.id, 'COMPLETED', null)
    return { processed: true, status: 'completed' }
  } catch (error: any) {
    const message = truncate(error?.message || String(error) || 'Unknown worker error')
    await setJobState(job.id, 'FAILED', message)
    await createAuditLog({ siteId: job.siteId, entityType: 'processing_job', entityId: job.id, action: 'processing-job.failed', details: { assetId: job.assetId, jobType: job.jobType, error: message } })
    return { processed: true, status: 'failed' }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null)
  }
}

export async function processQueuedJobs(limit = Number(process.env.WORKER_BATCH_SIZE || 10)) {
  const queued = await prisma.processingJob.findMany({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, select: { id: true }, take: limit })
  let processed = 0
  for (const item of queued) {
    const outcome = await processQueuedJob(item.id)
    if (outcome.processed) processed += 1
  }
  return processed
}
