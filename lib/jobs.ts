import { prisma } from './prisma'
import { createAuditLog } from './audit'

export const PROCESSING_JOB_TYPES = [
  'virus_scan',
  'extract_metadata',
  'image_thumbnail',
  'pdf_thumbnail',
  'audio_waveform',
  'audio_transcode',
  'video_transcode',
  'font_preview',
] as const

export type ProcessingJobType = (typeof PROCESSING_JOB_TYPES)[number]
export type ProcessingJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export async function queueProcessingJob(input: {
  siteId: string
  assetId: string
  versionId?: string | null
  jobType: string
  payload?: unknown
}) {
  try {
    return await prisma.processingJob.create({
      data: {
        siteId: input.siteId,
        assetId: input.assetId,
        versionId: input.versionId || undefined,
        jobType: input.jobType,
        status: 'QUEUED',
        payload: input.payload as any,
      },
    })
  } catch {
    await createAuditLog({
      siteId: input.siteId,
      entityType: 'processing_job',
      entityId: `${input.assetId}:${input.jobType}`,
      action: 'processing-job.queued',
      details: { assetId: input.assetId, versionId: input.versionId || null, jobType: input.jobType, payload: input.payload || null },
    })
    return null
  }
}

export async function queueDefaultProcessingJobs(input: {
  siteId: string
  assetId: string
  versionId?: string | null
  previewType?: string | null
  previewMimeType?: string | null
  downloadMimeType?: string | null
}) {
  const jobs: string[] = ['virus_scan', 'extract_metadata']
  if (input.previewType === 'IMAGE') jobs.push('image_thumbnail')
  if (input.previewType === 'PDF') jobs.push('pdf_thumbnail')
  if (input.previewType === 'AUDIO') jobs.push('audio_waveform', 'audio_transcode')
  if (input.previewType === 'VIDEO') jobs.push('video_transcode')
  if (input.previewType === 'FONT') jobs.push('font_preview')
  for (const jobType of jobs) {
    await queueProcessingJob({ siteId: input.siteId, assetId: input.assetId, versionId: input.versionId, jobType })
  }
}

export async function listProcessingJobs(siteId: string, take = 100) {
  try {
    return await prisma.processingJob.findMany({
      where: { siteId },
      include: { asset: true, version: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  } catch {
    return [] as any[]
  }
}

export async function updateProcessingJobStatus(jobId: string, status: ProcessingJobStatus, lastError?: string | null) {
  try {
    return await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status,
        attempts: { increment: status === 'PROCESSING' ? 1 : 0 },
        startedAt: status === 'PROCESSING' ? new Date() : undefined,
        finishedAt: status === 'COMPLETED' || status === 'FAILED' ? new Date() : undefined,
        lastError: lastError || undefined,
      },
    })
  } catch {
    return null
  }
}
