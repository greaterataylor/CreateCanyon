import { NextResponse } from 'next/server'
import { getActiveSite } from '@/lib/site'
import { getLicenseTemplates } from '@/lib/settings'

export async function GET() {
  const site = await getActiveSite()
  return NextResponse.json(getLicenseTemplates(site.settings))
}
