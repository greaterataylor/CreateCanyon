import { prisma } from '../lib/prisma'
import { processQueuedJobs } from '../lib/processing/pipeline'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runOnce() {
  const processed = await processQueuedJobs(Number(process.env.WORKER_BATCH_SIZE || 10))
  if (processed > 0) console.log(`[worker] processed ${processed} job${processed === 1 ? '' : 's'}`)
  else console.log('[worker] no queued jobs')
  return processed
}

async function main() {
  const once = process.argv.includes('--once')
  const pollMs = Number(process.env.WORKER_POLL_MS || 15000)

  try {
    do {
      await runOnce()
      if (once) break
      await sleep(pollMs)
    } while (true)
  } catch (error) {
    console.error('[worker] failed', error)
    process.exitCode = 1
  } finally {
    try {
      await prisma.$disconnect?.()
    } catch {
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
