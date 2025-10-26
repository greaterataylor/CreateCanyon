import { AssetStatus, VendorStatus } from '@prisma/client'

export const canSeeAsset = (status: AssetStatus) => status === 'APPROVED'
export const canUploadIfVendorApproved = (vendorStatus?: VendorStatus | null) => vendorStatus === 'APPROVED'
