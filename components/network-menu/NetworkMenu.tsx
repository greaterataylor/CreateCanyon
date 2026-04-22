'use client'

import React from 'react'
import clsx from 'clsx'
import {
  ecosystemMenuEntries,
  type EcosystemMenuEntry,
  type EcosystemMenuGroup,
  type EcosystemMenuIcon,
  type EcosystemMenuNode,
} from './ecosystemMenuData'
import { computeMenuLayout, useResponsiveMenuOverflow } from './useResponsiveMenuOverflow'

const MENU_CLOSE_DELAY_MS = 180
const OVERFLOW_KEY = '__ecosystem-overflow__'
const MENU_PANEL_WIDTH_CLASS = 'w-fit min-w-[180px] max-w-[220px]'

const TOPBAR_CLUSTER_CLASS_NAME = 'flex min-w-0 items-center justify-end gap-0.5 whitespace-nowrap'
const TOPBAR_TRIGGER_CLASS_NAME =
  'flex shrink-0 select-none items-center justify-center rounded-[10px] px-3 py-1.5 text-sm font-medium text-zinc-800 outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100'
const OVERFLOW_TRIGGER_CLASS_NAME =
  'flex h-[36px] w-[36px] shrink-0 select-none items-center justify-center rounded-[10px] text-zinc-800 outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100'
const PANEL_CLASS_NAME =
  'rounded-[18px] border border-zinc-200 bg-white p-3 text-zinc-900 shadow-[0_18px_40px_rgba(17,24,39,0.12)]'
const OVERFLOW_PANEL_CLASS_NAME =
  'min-w-[240px] rounded-[18px] border border-zinc-200 bg-white p-2 text-zinc-900 shadow-[0_18px_40px_rgba(17,24,39,0.12)]'
const PANEL_ITEM_CLASS_NAME =
  'flex w-full select-none items-center rounded-xl px-4 py-2.5 text-[15px] font-medium leading-none text-zinc-900 outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100'

type FlyoutDirection = 'left' | 'right'

function openExternalUrl(url: string, target: '_blank' | '_self' = '_blank') {
  if (!url || typeof window === 'undefined') return

  const features = target === '_blank' ? 'noopener,noreferrer' : undefined
  const openedWindow = window.open(url, target, features)

  if (openedWindow) {
    try {
      openedWindow.opener = null
    } catch {
      // Ignore cross-origin opener assignment issues.
    }
  }
}

function pathIsOpen(openPath: readonly string[], candidatePath: readonly string[]) {
  return candidatePath.every((value, index) => openPath[index] === value)
}

function MenuStrokeIcon({
  className,
  children,
  viewBox = '0 0 20 20',
}: {
  className?: string
  children: React.ReactNode
  viewBox?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={viewBox}
      fill="none"
      className={clsx('shrink-0 text-current', className)}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

function NetworkMenuIcon({ className }: { className?: string }) {
  return (
    <MenuStrokeIcon className={className}>
      <rect x="7.2" y="1.8" width="5.6" height="5.6" rx="1.1" />
      <rect x="1.8" y="12.6" width="5.6" height="5.6" rx="1.1" />
      <rect x="12.6" y="12.6" width="5.6" height="5.6" rx="1.1" />
      <path d="M10 7.6V10.8" />
      <path d="M10 10.8H4.6" />
      <path d="M10 10.8H15.4" />
    </MenuStrokeIcon>
  )
}

function SuitesMenuIcon({ className }: { className?: string }) {
  return (
    <MenuStrokeIcon className={className}>
      <rect x="1.8" y="1.8" width="5.6" height="5.6" rx="1.5" />
      <rect x="12.6" y="1.8" width="5.6" height="5.6" rx="1.5" />
      <rect x="1.8" y="12.6" width="5.6" height="5.6" rx="1.5" />
      <rect x="12.6" y="12.6" width="5.6" height="5.6" rx="1.5" />
    </MenuStrokeIcon>
  )
}

function AiMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Brain icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx('shrink-0 text-current', className)}
    >
      <path d="M9.2 3.2C7.8 3.2 6.7 4.1 6.3 5.4C4.9 5.7 4 6.9 4 8.3C4 9.1 4.3 9.8 4.8 10.3C4.3 10.8 4 11.5 4 12.3C4 13.7 4.9 14.9 6.2 15.2C6.4 17.2 7.9 18.6 9.8 18.6C10.8 18.6 11.7 18.2 12.3 17.5V6.4C11.8 4.5 10.7 3.2 9.2 3.2Z" />
      <path d="M14.8 3.2C16.2 3.2 17.3 4.1 17.7 5.4C19.1 5.7 20 6.9 20 8.3C20 9.1 19.7 9.8 19.2 10.3C19.7 10.8 20 11.5 20 12.3C20 13.7 19.1 14.9 17.8 15.2C17.6 17.2 16.1 18.6 14.2 18.6C13.2 18.6 12.3 18.2 11.7 17.5V6.4C12.2 4.5 13.3 3.2 14.8 3.2Z" />
      <path d="M9.4 7.2C8.6 7.5 8 8.3 8 9.2C8 10 8.4 10.7 9 11.1" />
      <path d="M8.8 13.2C9.2 13.8 10 14.2 10.8 14.2" />
      <path d="M14.6 7.2C15.4 7.5 16 8.3 16 9.2C16 10 15.6 10.7 15 11.1" />
      <path d="M15.2 13.2C14.8 13.8 14 14.2 13.2 14.2" />
      <path d="M12 6.2V17.2" />
    </svg>
  )
}

function CreateCanyonMenuIcon({ className }: { className?: string }) {
  return (
    <MenuStrokeIcon className={className}>
      <path d="M10.1 2.4c4 0 7.2 2.8 7.2 6.3 0 2.2-1.3 3.9-3.4 4.8.2.3.3.8.3 1.2 0 1.6-1.2 2.7-2.8 2.7-4.9 0-8.8-3.6-8.8-8 0-3.9 3.3-7 7.5-7Z" />
      <circle cx="6.3" cy="7.5" r="0.95" />
      <circle cx="10.1" cy="6.1" r="0.95" />
      <circle cx="13.7" cy="7.5" r="0.95" />
      <circle cx="8.3" cy="12" r="1.15" />
    </MenuStrokeIcon>
  )
}

function DeployMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Deploy icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx('shrink-0 text-current', className)}
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  )
}

function ComposeMenuIcon({ className }: { className?: string }) {
  return (
    <MenuStrokeIcon className={className}>
      <path d="M10 3.1L16.9 16.9H3.1L10 3.1Z" />
    </MenuStrokeIcon>
  )
}

function OrganizeMenuIcon({ className }: { className?: string }) {
  return (
    <MenuStrokeIcon className={className}>
      <path d="M4.2 2.6H12.1L15.8 6.3V17.4H4.2V2.6Z" />
      <path d="M12.1 2.6V6.3H15.8" />
      <path d="M6.9 9.4H13.1" />
      <path d="M6.9 12.2H12.1" />
    </MenuStrokeIcon>
  )
}

function ImagineMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Thought cloud icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx('shrink-0 text-current', className)}
    >
      <path d="M8.2 17.8H16.4C18.8 17.8 20.5 16.2 20.5 14C20.5 11.9 18.9 10.3 16.9 10.2C16.6 7.7 14.6 6 12 6C9.8 6 7.9 7.2 7.1 9.1C4.8 9.2 3 11 3 13.3C3 15.8 5 17.8 7.5 17.8H8.2Z" />
    </svg>
  )
}

function EcosystemMenuGlyph({ icon, className }: { icon?: EcosystemMenuIcon; className?: string }) {
  if (icon === 'network') return <NetworkMenuIcon className={clsx(className, 'h-[17px] w-[17px]')} />
  if (icon === 'suites') return <SuitesMenuIcon className={className} />
  if (icon === 'ai') return <AiMenuIcon className={clsx(className, 'h-[23px] w-[23px]')} />
  if (icon === 'create-canyon') {
    return <CreateCanyonMenuIcon className={clsx(className, 'h-[20px] w-[20px]')} />
  }
  if (icon === 'deploy') return <DeployMenuIcon className={clsx(className, 'h-[19px] w-[19px]')} />
  if (icon === 'compose') return <ComposeMenuIcon className={clsx(className, 'h-[20px] w-[20px]')} />
  if (icon === 'organize') return <OrganizeMenuIcon className={clsx(className, 'h-[20px] w-[20px]')} />
  if (icon === 'imagine') return <ImagineMenuIcon className={clsx(className, 'h-[24px] w-[24px]')} />
  return null
}

function EcosystemMenuItemLabel({
  label,
  icon,
  compact = false,
}: {
  label: string
  icon?: EcosystemMenuIcon
  compact?: boolean
}) {
  return (
    <span
      className={clsx(
        'flex max-w-full items-center text-left font-medium tracking-[-0.01em]',
        compact
          ? 'gap-2.5 text-sm leading-none text-current'
          : 'gap-3 text-[15px] leading-[1.45] text-zinc-900'
      )}
    >
      <EcosystemMenuGlyph icon={icon} className={compact ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
      <span>{label}</span>
    </span>
  )
}

function HamburgerOverflowIcon() {
  return (
    <span aria-hidden="true" className="flex h-[14px] w-[18px] flex-col justify-between text-current">
      <span className="block h-[2.5px] w-full rounded-full bg-current" />
      <span className="block h-[2.5px] w-full rounded-full bg-current" />
      <span className="block h-[2.5px] w-full rounded-full bg-current" />
    </span>
  )
}

export default function NetworkMenu() {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const closeTimerRef = React.useRef<number | null>(null)
  const [availableWidth, setAvailableWidth] = React.useState(0)
  const [openPath, setOpenPath] = React.useState<string[]>([])

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closeMenus = React.useCallback(() => {
    clearCloseTimer()
    setOpenPath([])
  }, [clearCloseTimer])

  const openPathTo = React.useCallback(
    (nextPath: string[]) => {
      clearCloseTimer()
      setOpenPath((currentPath) => {
        if (
          currentPath.length === nextPath.length &&
          currentPath.every((segment, index) => segment === nextPath[index])
        ) {
          return currentPath
        }

        return nextPath
      })
    },
    [clearCloseTimer]
  )

  const scheduleClose = React.useCallback(
    (delay = MENU_CLOSE_DELAY_MS) => {
      clearCloseTimer()
      closeTimerRef.current = window.setTimeout(() => {
        setOpenPath([])
        closeTimerRef.current = null
      }, delay)
    },
    [clearCloseTimer]
  )

  React.useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    },
    []
  )

  React.useEffect(() => {
    if (openPath.length === 0) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      closeMenus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenus, openPath.length])

  React.useLayoutEffect(() => {
    const measureAvailableWidth = () => {
      const node = rootRef.current
      if (!node) return
      const computedStyle = window.getComputedStyle(node)
      const paddingInline =
        (parseFloat(computedStyle.paddingLeft || '0') || 0) +
        (parseFloat(computedStyle.paddingRight || '0') || 0)
      setAvailableWidth(Math.max(0, Math.floor(node.clientWidth - paddingInline)))
    }

    measureAvailableWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureAvailableWidth)
      return () => window.removeEventListener('resize', measureAvailableWidth)
    }

    const observer = new ResizeObserver(measureAvailableWidth)
    if (rootRef.current) observer.observe(rootRef.current)

    return () => observer.disconnect()
  }, [])

  const entryKeys = React.useMemo(() => ecosystemMenuEntries.map((entry) => entry.key), [])
  const topbarLabels = React.useMemo(
    () =>
      ecosystemMenuEntries.map((entry) => (
        <EcosystemMenuItemLabel key={entry.key} label={entry.label} icon={entry.icon} compact />
      )),
    []
  )

  const overflowTrigger = React.useMemo(() => <HamburgerOverflowIcon />, [])

  const { measurementDeck, measurements } = useResponsiveMenuOverflow({
    itemKeys: entryKeys,
    itemContents: topbarLabels,
    containerClassName: TOPBAR_CLUSTER_CLASS_NAME,
    triggerClassName: TOPBAR_TRIGGER_CLASS_NAME,
    overflowTriggerClassName: OVERFLOW_TRIGGER_CLASS_NAME,
    overflowTrigger,
  })

  const visibleCount = React.useMemo(() => {
    if (!measurements.measurementsReady || availableWidth <= 0) return ecosystemMenuEntries.length

    for (let count = ecosystemMenuEntries.length; count >= 0; count -= 1) {
      const layout = computeMenuLayout(measurements, count, ecosystemMenuEntries.length)
      if (layout.width <= availableWidth) return count
    }

    return 0
  }, [availableWidth, measurements])

  const visibleEntries = React.useMemo(
    () => ecosystemMenuEntries.slice(0, visibleCount),
    [visibleCount]
  )
  const hiddenEntries = React.useMemo(
    () => ecosystemMenuEntries.slice(visibleCount),
    [visibleCount]
  )

  React.useEffect(() => {
    if (!openPath.length) return

    const visibleValues = new Set(visibleEntries.map((entry) => entry.key))
    if (hiddenEntries.length > 0) visibleValues.add(OVERFLOW_KEY)

    if (!visibleValues.has(openPath[0])) {
      closeMenus()
    }
  }, [closeMenus, hiddenEntries.length, openPath, visibleEntries])

  const handleRootPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && rootRef.current?.contains(relatedTarget)) {
        clearCloseTimer()
        return
      }
      scheduleClose()
    },
    [clearCloseTimer, scheduleClose]
  )

  const handleRootBlur = React.useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && rootRef.current?.contains(relatedTarget)) {
        clearCloseTimer()
        return
      }
      scheduleClose(0)
    },
    [clearCloseTimer, scheduleClose]
  )

  function renderGroups(groups: readonly EcosystemMenuGroup[], parentPath: string[], direction: FlyoutDirection) {
    return (
      <>
        {groups.map((group, groupIndex) => (
          <React.Fragment key={`${parentPath.join('-')}-${group.heading ?? groupIndex}`}>
            {groupIndex > 0 ? <div className="mx-3 my-2.5 h-px bg-zinc-200" /> : null}
            {group.items.map((item) => renderNode(item, parentPath, direction))}
          </React.Fragment>
        ))}
      </>
    )
  }

  function renderNode(node: EcosystemMenuNode, parentPath: string[], direction: FlyoutDirection): React.ReactNode {
    if (node.kind === 'link') {
      return (
        <button
          key={node.key}
          type="button"
          role="menuitem"
          className={PANEL_ITEM_CLASS_NAME}
          onPointerEnter={() => openPathTo(parentPath)}
          onFocus={() => openPathTo(parentPath)}
          onClick={() => {
            openExternalUrl(node.href, node.href === '/' ? '_self' : '_blank')
            closeMenus()
          }}
        >
          <EcosystemMenuItemLabel label={node.label} icon={node.icon} />
        </button>
      )
    }

    const nodePath = [...parentPath, node.key]
    const isOpen = pathIsOpen(openPath, nodePath)

    return (
      <div key={node.key} className="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          className={clsx(PANEL_ITEM_CLASS_NAME, isOpen && 'bg-zinc-100')}
          onPointerEnter={() => openPathTo(nodePath)}
          onFocus={() => openPathTo(nodePath)}
          onClick={(event) => {
            event.preventDefault()
            if (node.href) {
              openExternalUrl(node.href, node.href === '/' ? '_self' : '_blank')
              closeMenus()
              return
            }
            openPathTo(isOpen ? parentPath : nodePath)
          }}
        >
          <EcosystemMenuItemLabel label={node.label} icon={node.icon} />
        </button>
        {isOpen ? (
          <div
            className={clsx(
              'absolute top-[-12px] z-[70]',
              direction === 'right' ? 'left-[calc(100%-4px)]' : 'right-[calc(100%-4px)]'
            )}
          >
            <div role="menu" className={clsx(MENU_PANEL_WIDTH_CLASS, PANEL_CLASS_NAME)}>
              {renderGroups(node.groups, nodePath, direction)}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  function renderTopEntry(entry: EcosystemMenuEntry) {
    if (entry.kind === 'link') {
      return (
        <button
          key={entry.key}
          type="button"
          className={TOPBAR_TRIGGER_CLASS_NAME}
          onPointerEnter={closeMenus}
          onFocus={closeMenus}
          onClick={() => openExternalUrl(entry.href, entry.href === '/' ? '_self' : '_blank')}
        >
          <EcosystemMenuItemLabel label={entry.label} icon={entry.icon} compact />
        </button>
      )
    }

    const entryPath = [entry.key]
    const isOpen = pathIsOpen(openPath, entryPath)

    return (
      <div key={entry.key} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          className={clsx(TOPBAR_TRIGGER_CLASS_NAME, isOpen && 'bg-zinc-100')}
          onPointerEnter={() => openPathTo(entryPath)}
          onPointerMove={() => openPathTo(entryPath)}
          onFocus={() => openPathTo(entryPath)}
          onClick={(event) => {
            event.preventDefault()
            if (entry.href) {
              openExternalUrl(entry.href, entry.href === '/' ? '_self' : '_blank')
              closeMenus()
              return
            }
            openPathTo(isOpen ? [] : entryPath)
          }}
        >
          <EcosystemMenuItemLabel label={entry.label} icon={entry.icon} compact />
        </button>
        {isOpen ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-[70]">
            <div role="menu" className={clsx(MENU_PANEL_WIDTH_CLASS, PANEL_CLASS_NAME)}>
              {renderGroups(entry.groups, entryPath, 'right')}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const overflowOpen = pathIsOpen(openPath, [OVERFLOW_KEY])

  return (
    <div
      ref={rootRef}
      className="relative flex min-w-0 items-center justify-end"
      onPointerEnter={clearCloseTimer}
      onPointerLeave={handleRootPointerLeave}
      onFocusCapture={clearCloseTimer}
      onBlurCapture={handleRootBlur}
    >
      {measurementDeck}

      <div role="menubar" aria-label="CreateCanyon network navigation" className={TOPBAR_CLUSTER_CLASS_NAME}>
        {visibleEntries.map((entry) => renderTopEntry(entry))}

        {hiddenEntries.length > 0 ? (
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label="More network destinations"
              className={clsx(OVERFLOW_TRIGGER_CLASS_NAME, overflowOpen && 'bg-zinc-100')}
              onPointerEnter={() => openPathTo([OVERFLOW_KEY])}
              onPointerMove={() => openPathTo([OVERFLOW_KEY])}
              onFocus={() => openPathTo([OVERFLOW_KEY])}
              onClick={() => openPathTo(overflowOpen ? [] : [OVERFLOW_KEY])}
            >
              <HamburgerOverflowIcon />
            </button>

            {overflowOpen ? (
              <div className="absolute right-0 top-[calc(100%+8px)] z-[70]">
                <div role="menu" className={OVERFLOW_PANEL_CLASS_NAME}>
                  {hiddenEntries.map((entry) => renderNode(entry, [OVERFLOW_KEY], 'left'))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
