type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/**
 * Array patch operations keep large list updates cheap over the wire.
 * The manager/browser contract prefers explicit patch kinds so both sides
 * can recover from missed updates without guessing the server intent.
 */
export interface SectionArraySplicePatch<T = JsonValue> {
  kind: 'splice'
  index: number
  deleteCount: number
  items: T[]
}

export interface SectionArrayAppendPatch<T = JsonValue> {
  kind: 'append'
  trimStart: number
  items: T[]
}

export interface SectionArrayReplacePatch<T = JsonValue> {
  kind: 'replace'
  items: T[]
}

export type SectionArrayPatch<T = JsonValue> =
  | SectionArraySplicePatch<T>
  | SectionArrayAppendPatch<T>
  | SectionArrayReplacePatch<T>

export type SectionPayload<T> = T | SectionArrayPatch

/**
 * SectionDelta describes either a full reset or an incremental section patch.
 * The same shape is reused for instance detail state and manager overview state.
 */
export interface SectionDelta<T extends object> {
  seq: number
  kind: 'reset' | 'patch'
  state?: T
  sections?: Partial<{ [K in keyof T]: SectionPayload<T[K]> }>
}

export interface ParsedSectionSelection<K extends string> {
  sections: K[] | null
  invalid: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonLike(value: unknown): value is JsonValue {
  if (value == null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(item => isJsonLike(item))
  if (isObject(value)) return Object.values(value).every(item => isJsonLike(item))
  return false
}

export function isArrayPatch(value: unknown): value is SectionArrayPatch {
  if (!isObject(value) || typeof value.kind !== 'string') return false
  if (value.kind === 'replace') {
    return Array.isArray(value.items)
  }
  if (value.kind === 'splice') {
    return typeof value.index === 'number'
      && typeof value.deleteCount === 'number'
      && Array.isArray(value.items)
  }
  if (value.kind === 'append') {
    return typeof value.trimStart === 'number'
      && Array.isArray(value.items)
  }
  return false
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function diffArraySection<T extends JsonValue>(previous: T[], next: T[]): SectionArrayPatch<T> {
  if (stableStringify(previous) === stableStringify(next)) {
    return { kind: 'splice', index: previous.length, deleteCount: 0, items: [] }
  }

  let appendPatch: SectionArrayAppendPatch<T> | null = null
  for (let trimStart = 1; trimStart <= previous.length; trimStart += 1) {
    const retainedLength = previous.length - trimStart
    if (retainedLength > next.length) continue

    let matches = true
    for (let index = 0; index < retainedLength; index += 1) {
      if (stableStringify(previous[trimStart + index]) !== stableStringify(next[index])) {
        matches = false
        break
      }
    }

    if (matches) {
      appendPatch = {
        kind: 'append',
        trimStart,
        items: next.slice(retainedLength),
      }
      break
    }
  }

  let prefix = 0
  const maxPrefix = Math.min(previous.length, next.length)
  while (prefix < maxPrefix && stableStringify(previous[prefix]) === stableStringify(next[prefix])) {
    prefix += 1
  }

  let previousSuffix = previous.length - 1
  let nextSuffix = next.length - 1
  while (
    previousSuffix >= prefix
    && nextSuffix >= prefix
    && stableStringify(previous[previousSuffix]) === stableStringify(next[nextSuffix])
  ) {
    previousSuffix -= 1
    nextSuffix -= 1
  }

  const deleteCount = Math.max(0, previousSuffix - prefix + 1)
  const items = next.slice(prefix, nextSuffix + 1)
  const patch: SectionArrayPatch<T> = {
    kind: 'splice',
    index: prefix,
    deleteCount,
    items,
  }

  const patchSize = stableStringify(patch).length
  const appendPatchSize = appendPatch ? stableStringify(appendPatch).length : Number.POSITIVE_INFINITY
  const replaceSize = stableStringify(next).length
  if (appendPatch && appendPatchSize < patchSize && appendPatchSize < replaceSize) {
    return appendPatch
  }
  if (patchSize >= replaceSize) {
    return { kind: 'replace', items: next }
  }

  return patch
}

/**
 * Compute a section-aware delta between two plain JSON-shaped states.
 * Arrays get structural patches; object/scalar sections are replaced whole.
 */
export function computeSectionDelta<T extends object>(
  previous: T | undefined,
  next: T,
  seq: number,
): SectionDelta<T> {
  if (!previous) {
    return { seq, kind: 'reset', state: next }
  }

  const sections: Partial<{ [K in keyof T]: SectionPayload<T[K]> }> = {}
  for (const key of Object.keys(next as object) as Array<keyof T>) {
    const previousValue = previous[key]
    const nextValue = next[key]
    if (stableStringify(previousValue) === stableStringify(nextValue)) {
      continue
    }

    if (Array.isArray(previousValue) && Array.isArray(nextValue) && nextValue.every(item => isJsonLike(item))) {
      sections[key] = diffArraySection(previousValue as JsonValue[], nextValue as JsonValue[]) as SectionPayload<T[keyof T]>
      continue
    }

    sections[key] = nextValue as SectionPayload<T[keyof T]>
  }

  return { seq, kind: 'patch', sections }
}

export function parseSectionSelection<K extends string>(
  raw: string | null | undefined,
  validSections: readonly K[],
): ParsedSectionSelection<K> {
  if (raw == null) {
    return { sections: null, invalid: [] }
  }

  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    return { sections: [], invalid: [] }
  }

  const valid = new Set<string>(validSections)
  const sections: K[] = []
  const invalid: string[] = []

  for (const token of tokens) {
    if (!valid.has(token)) {
      invalid.push(token)
      continue
    }

    const section = token as K
    if (!sections.includes(section)) {
      sections.push(section)
    }
  }

  return { sections, invalid }
}

export function filterStateSections<T extends object, K extends keyof T>(
  state: T | Partial<T>,
  selectedSections: readonly K[] | null,
): T | Partial<T> {
  if (!selectedSections) {
    return state
  }

  const filtered: Partial<T> = {}
  for (const key of selectedSections) {
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      filtered[key] = state[key] as T[K]
    }
  }
  return filtered
}

export function filterSectionDelta<T extends object, K extends keyof T>(
  delta: SectionDelta<T>,
  selectedSections: readonly K[] | null,
): SectionDelta<Partial<T>> {
  if (!selectedSections) {
    return delta as SectionDelta<Partial<T>>
  }

  if (delta.kind === 'reset') {
    if (!delta.state) {
      throw new Error('Reset delta missing full state payload')
    }

    return {
      seq: delta.seq,
      kind: 'reset',
      state: filterStateSections(delta.state, selectedSections) as Partial<T>,
    }
  }

  return {
    seq: delta.seq,
    kind: 'patch',
    sections: filterStateSections(delta.sections ?? {}, selectedSections) as Partial<{ [P in keyof T]: SectionPayload<T[P]> }>,
  }
}

/**
 * Apply an incoming delta onto a previous state snapshot.
 * This is the browser-side equivalent of the server's patch emission logic.
 */
export function applySectionDelta<T extends object>(
  previous: T | undefined,
  delta: SectionDelta<T>,
): T {
  const current = previous
  if (delta.kind === 'reset') {
    if (!delta.state) {
      throw new Error('Reset delta missing full state payload')
    }
    return delta.state
  }

  if (!current) {
    throw new Error('Patch delta requires an existing state')
  }

  const nextState = { ...current }
  for (const key of Object.keys(delta.sections ?? {}) as Array<keyof T>) {
    const value = delta.sections?.[key] as SectionPayload<T[keyof T]> | undefined
    if (value === undefined) continue

    if (Array.isArray(nextState[key]) && isArrayPatch(value)) {
      const currentItems = Array.isArray(nextState[key]) ? [...(nextState[key] as unknown[])] : []
      if (value.kind === 'replace') {
        nextState[key] = [...value.items] as T[keyof T]
      } else if (value.kind === 'append') {
        nextState[key] = [...currentItems.slice(value.trimStart), ...value.items] as T[keyof T]
      } else {
        currentItems.splice(value.index, value.deleteCount, ...value.items)
        nextState[key] = currentItems as T[keyof T]
      }
      continue
    }

    nextState[key] = value as T[keyof T]
  }

  return nextState
}

/**
 * Replay contiguous deltas from history. A null result signals desync and tells
 * the caller to fall back to a full reset instead of guessing missing state.
 */
export function collectReplayDeltas<T extends object>(
  history: Array<SectionDelta<T>>,
  lastSeenSeq: number,
): Array<SectionDelta<T>> | null {
  if (history.length === 0) return []

  const newestSeq = history[history.length - 1]?.seq ?? 0
  if (lastSeenSeq >= newestSeq) return []

  const expectedNext = lastSeenSeq + 1
  const startIndex = history.findIndex((delta) => delta.seq === expectedNext)
  if (startIndex === -1) return null

  const replay = history.slice(startIndex)
  for (let index = 0; index < replay.length; index += 1) {
    if (replay[index]?.seq !== expectedNext + index) {
      return null
    }
  }

  return replay
}
