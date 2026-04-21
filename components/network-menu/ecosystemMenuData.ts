export type EcosystemMenuIcon =
  | 'network'
  | 'suites'
  | 'ai'
  | 'create-canyon'
  | 'imagine'
  | 'organize'
  | 'deploy'
  | 'compose'

export type EcosystemMenuLink = {
  kind: 'link'
  key: string
  label: string
  href: string
  icon?: EcosystemMenuIcon
}

export type EcosystemMenuGroup = {
  heading?: string
  items: readonly EcosystemMenuNode[]
}

export type EcosystemMenuMenu = {
  kind: 'menu'
  key: string
  label: string
  href?: string
  icon?: EcosystemMenuIcon
  groups: readonly EcosystemMenuGroup[]
}

export type EcosystemMenuNode = EcosystemMenuLink | EcosystemMenuMenu
export type EcosystemMenuEntry = EcosystemMenuNode

function createKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function appLink(
  label: string,
  options: Partial<Pick<EcosystemMenuLink, 'href' | 'icon' | 'key'>> = {}
): EcosystemMenuLink {
  return {
    kind: 'link',
    key: options.key ?? createKey(label),
    label,
    href: options.href ?? `https://${label}.com`,
    ...(options.icon ? { icon: options.icon } : {}),
  }
}

function group(...items: EcosystemMenuNode[]): EcosystemMenuGroup {
  return { items }
}

function menu(
  label: string,
  groups: readonly EcosystemMenuGroup[],
  options: Partial<Pick<EcosystemMenuMenu, 'href' | 'icon' | 'key'>> = {}
): EcosystemMenuMenu {
  return {
    kind: 'menu',
    key: options.key ?? createKey(label),
    label,
    groups,
    ...(options.href ? { href: options.href } : {}),
    ...(options.icon ? { icon: options.icon } : {}),
  }
}

const imagineMenu = menu(
  'Imagine',
  [
    group(
      appLink('PicPlayer'),
      appLink('DrawDomain'),
      appLink('RefineRaw'),
      appLink('LayoutLift'),
      appLink('UIUniverse')
    ),
    group(appLink('SceneShaper'), appLink('AnimateArena'), appLink('EffectsEngine')),
    group(appLink('DecibelDesk'), appLink('BandBeats')),
    group(appLink('PaperPoet'), appLink('StoryboardSmith')),
    group(appLink('FocalFolio')),
  ],
  { key: 'suites-imagine', icon: 'imagine' }
)

const organizeMenu = menu(
  'Organize',
  [
    group(appLink('ParagraphPro'), appLink('PresentPad'), appLink('SumSmith'), appLink('NumberNode')),
    group(appLink('DynamicDiary'), appLink('PDFPioneer')),
    group(appLink('PlannerPlatform'), appLink('MapMedium')),
    group(appLink('TalkTerminal')),
  ],
  { key: 'suites-organize', icon: 'organize' }
)

const deployMenu = menu(
  'Deploy',
  [
    group(appLink('ScriptSpring'), appLink('CommitCove')),
    group(appLink('CollabConsole'), appLink('LibraryLore')),
    group(appLink('PlugPlayground'), appLink('RuntimeRocket')),
    group(appLink('AlarmAxis'), appLink('UptimeUtility')),
    group(appLink('ResolveRocket')),
  ],
  { key: 'suites-deploy', icon: 'deploy' }
)

const composeMenu = menu(
  'Compose',
  [group(appLink('ConstructCanvas'), appLink('ModelMotive'), appLink('KitConstructor'))],
  { key: 'suites-compose', icon: 'compose' }
)

const suitesMenu = menu(
  'Suites',
  [group(imagineMenu, organizeMenu, deployMenu, composeMenu)],
  {
    key: 'network-suites',
    icon: 'suites',
  }
)

const networkMenu = menu(
  'Network',
  [group(appLink('MonetizeMakers'), appLink('PhotoTalent'))],
  {
    key: 'network-apps',
    icon: 'network',
  }
)

const aiMenu = menu(
  'AI',
  [group(appLink('BrainyBinary'), appLink('NeuralNanny')), group(appLink('UsefulUtility'))],
  { key: 'network-ai', icon: 'ai' }
)

const createCanyonMenu = menu(
  'CreateCanyon',
  [
    group(appLink('CreateCanyon', { href: '/' })),
    group(appLink('GraphicGrounds')),
    group(appLink('MelodyMerchant')),
    group(appLink('ProgramPlaza')),
    group(appLink('FileFoyer')),
  ],
  { key: 'network-create-canyon', icon: 'create-canyon' }
)

export const ecosystemMenuEntries: readonly EcosystemMenuEntry[] = [
  appLink('Artboardr'),
  appLink('StorySim'),
  suitesMenu,
  networkMenu,
  aiMenu,
  appLink('DocDome'),
  createCanyonMenu,
  appLink('ZenBinary'),
]
