import { AuthError, currentUser } from './auth'
import { prisma } from './prisma'

type AssetStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED'
type VendorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'

export const canSeeAsset = (status: AssetStatus) => status === 'APPROVED'
export const canUploadIfVendorApproved = (vendorStatus?: VendorStatus | null) => vendorStatus === 'APPROVED'

export async function userIsSiteAdmin(userId: string, siteId: string) {
  const membership = await prisma.siteAdminMembership.findUnique({ where: { userId_siteId: { userId, siteId } } })
  return !!membership
}

export async function requireAdminForSite(siteId: string) {
  const user = await currentUser()
  if (!user) throw new AuthError('UNAUTHORIZED')
  if (user.role === 'SUPER_ADMIN') return user
  const isSiteAdmin = user.siteAdminMemberships.some((membership: any) => membership.siteId === siteId)
  if (!isSiteAdmin) throw new AuthError('FORBIDDEN')
  return user
}
