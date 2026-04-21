'use client'

import React from 'react'

export type ResponsiveMenuMeasurements = {
  measurementsReady: boolean
  naturalWidth: number
  minimumWidth: number
  overflowTriggerWidth: number
  itemWidths: number[]
  gap: number
  paddingInline: number
}

export type ResponsiveMenuLayout = {
  visibleCount: number
  hiddenCount: number
  hasOverflow: boolean
  width: number
}

const EMPTY_MEASUREMENTS: ResponsiveMenuMeasurements = {
  measurementsReady: false,
  naturalWidth: 0,
  minimumWidth: 0,
  overflowTriggerWidth: 0,
  itemWidths: [],
  gap: 0,
  paddingInline: 0,
}

function roundWidth(value: number) {
  return Math.ceil(Number.isFinite(value) ? value : 0)
}

function sumItemWidths(widths: readonly number[], count = widths.length) {
  return widths.slice(0, count).reduce((sum, width) => sum + width, 0)
}

function shallowEqualWidths(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

export function computeMenuClusterWidth(
  measurements: ResponsiveMenuMeasurements,
  visibleCount: number,
  totalCount = measurements.itemWidths.length
) {
  if (!measurements.measurementsReady) return 0

  const safeVisibleCount = Math.max(0, Math.min(visibleCount, totalCount))
  const hasOverflow = safeVisibleCount < totalCount
  const visibleWidth = sumItemWidths(measurements.itemWidths, safeVisibleCount)
  const visibleGaps = safeVisibleCount > 0 ? Math.max(0, safeVisibleCount - 1) * measurements.gap : 0
  const overflowGap = hasOverflow && safeVisibleCount > 0 ? measurements.gap : 0

  return roundWidth(
    measurements.paddingInline +
      visibleWidth +
      visibleGaps +
      overflowGap +
      (hasOverflow ? measurements.overflowTriggerWidth : 0)
  )
}

export function computeMenuLayout(
  measurements: ResponsiveMenuMeasurements,
  visibleCount: number,
  totalCount = measurements.itemWidths.length
): ResponsiveMenuLayout {
  const safeVisibleCount = Math.max(0, Math.min(visibleCount, totalCount))

  return {
    visibleCount: safeVisibleCount,
    hiddenCount: Math.max(0, totalCount - safeVisibleCount),
    hasOverflow: safeVisibleCount < totalCount,
    width: computeMenuClusterWidth(measurements, safeVisibleCount, totalCount),
  }
}

export function useResponsiveMenuOverflow({
  itemKeys,
  itemContents,
  containerClassName,
  triggerClassName,
  overflowTrigger,
  overflowTriggerClassName,
}: {
  itemKeys: readonly string[]
  itemContents: readonly React.ReactNode[]
  containerClassName: string
  triggerClassName: string
  overflowTrigger: React.ReactNode
  overflowTriggerClassName?: string
}) {
  const measurementRootRef = React.useRef<HTMLDivElement | null>(null)
  const overflowTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const itemRefs = React.useRef<Record<string, HTMLButtonElement | null>>({})
  const [measurements, setMeasurements] = React.useState<ResponsiveMenuMeasurements>(EMPTY_MEASUREMENTS)

  const setItemRef = React.useCallback(
    (key: string) => (node: HTMLButtonElement | null) => {
      itemRefs.current[key] = node
    },
    []
  )

  const measure = React.useCallback(() => {
    const root = measurementRootRef.current
    const overflowTriggerNode = overflowTriggerRef.current
    if (!root || !overflowTriggerNode) return

    const computedStyle = window.getComputedStyle(root)
    const gap = parseFloat(computedStyle.columnGap || computedStyle.gap || '0') || 0
    const paddingInline =
      (parseFloat(computedStyle.paddingLeft || '0') || 0) +
      (parseFloat(computedStyle.paddingRight || '0') || 0)

    const itemWidths = itemKeys.map((key) => roundWidth(itemRefs.current[key]?.getBoundingClientRect().width || 0))
    const overflowTriggerWidth = roundWidth(overflowTriggerNode.getBoundingClientRect().width)
    const widthsReady = overflowTriggerWidth > 0 && itemWidths.every((width) => width > 0)
    const naturalWidth = roundWidth(
      paddingInline + sumItemWidths(itemWidths) + Math.max(0, itemWidths.length - 1) * gap
    )
    const minimumWidth = roundWidth(paddingInline + overflowTriggerWidth)

    setMeasurements((current) => {
      if (
        current.measurementsReady === widthsReady &&
        current.naturalWidth === naturalWidth &&
        current.minimumWidth === minimumWidth &&
        current.overflowTriggerWidth === overflowTriggerWidth &&
        current.gap === gap &&
        current.paddingInline === paddingInline &&
        shallowEqualWidths(current.itemWidths, itemWidths)
      ) {
        return current
      }

      return {
        measurementsReady: widthsReady,
        naturalWidth,
        minimumWidth,
        overflowTriggerWidth,
        itemWidths,
        gap,
        paddingInline,
      }
    })
  }, [itemKeys])

  React.useLayoutEffect(() => {
    measure()
  }, [measure, containerClassName, itemContents, overflowTrigger, overflowTriggerClassName, triggerClassName])

  React.useEffect(() => {
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(() => {
      measure()
    })

    const root = measurementRootRef.current
    if (root) observer.observe(root)

    const overflowNode = overflowTriggerRef.current
    if (overflowNode) observer.observe(overflowNode)

    itemKeys.forEach((key) => {
      const node = itemRefs.current[key]
      if (node) observer.observe(node)
    })

    return () => observer.disconnect()
  }, [itemKeys, measure])

  const measurementDeck = (
    <div aria-hidden className="pointer-events-none absolute -left-[10000px] top-0 opacity-0">
      <div ref={measurementRootRef} className={containerClassName}>
        {itemKeys.map((key, index) => (
          <button key={key} ref={setItemRef(key)} type="button" className={triggerClassName}>
            {itemContents[index]}
          </button>
        ))}
        <button ref={overflowTriggerRef} type="button" className={overflowTriggerClassName ?? triggerClassName}>
          {overflowTrigger}
        </button>
      </div>
    </div>
  )

  return {
    measurements,
    measurementDeck,
  }
}
