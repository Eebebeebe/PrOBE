import { IBlueprint, IBlueprintBook, IBlueprintBookEntry, IIcon } from '../types'
import { Blueprint, getFactorioVersion } from './Blueprint'
import { AmbiguousLabelError, BookPathError } from './errors'
import { need } from './need'

class Book {
    /*
        The blueprint currently open, absent until selectBlueprint has opened one.
        A freshly constructed Book has none, which is why saveActiveBlueprint
        below is written as `if (this._active)`.
    */
    private _active: Blueprint | undefined
    /**
     * The flattened index of the open blueprint, or undefined when the book's
     * active slot holds no blueprint: an empty slot, a planner, or a nested book
     * with nothing active. Factorio then puts only the book in the cursor, so
     * the editor opens an empty view (`_active` is then detached from the book).
     */
    private _activeIndex: number | undefined
    /** The slot `active_index` names, written back unchanged until a blueprint is opened. */
    private activeSlot: number
    private readonly blueprints: IBlueprintBookEntry[]

    private readonly m_label?: string
    private readonly m_description?: string
    private readonly icons?: IIcon[]

    public constructor(data: IBlueprintBook) {
        if (data) {
            this.blueprints = data.blueprints || []
            this.activeSlot = data.active_index ?? 0
            this._activeIndex = resolveActiveIndex(this.blueprints, this.activeSlot)
            this.m_label = data.label
            this.m_description = data.description
            this.icons = data.icons
        } else {
            this.blueprints = []
            this.activeSlot = 0
            this._activeIndex = undefined
        }
    }

    /** Flattened index of the open blueprint; undefined when nothing is open. */
    public get activeIndex(): number | undefined {
        return this._activeIndex
    }

    /** The book's own label; undefined when it has none. */
    public get label(): string | undefined {
        return this.m_label
    }

    /** The book's own description; undefined when it has none. */
    public get description(): string | undefined {
        return this.m_description
    }

    /**
     * Everything the book holds, as a tree. Each entry carries its path of
     * slots - `[5, 2]` is slot 2 of the book in slot 5 - which is how the other
     * methods address it. The open blueprint is saved into the book first, so
     * a label changed in the editor shows here.
     */
    public entries(): BookEntryInfo[] {
        this.saveActiveBlueprint()
        return describeEntries(this.blueprints, [])
    }

    /**
     * Paths of every blueprint labelled `label`, in slot order. Nested books
     * are searched unless `recursive` is false. Entries whose label starts
     * with '#' - a #code book and everything in it - are left out unless
     * `includeHidden` is set.
     */
    public findAllByLabel(label: string, opts: FindOptions = {}): number[][] {
        const { recursive = true, includeHidden = false } = opts
        const out: number[][] = []
        const walk = (entries: BookEntryInfo[]): void => {
            for (const e of entries) {
                if (!includeHidden && e.label?.startsWith('#')) continue
                if (e.kind === 'blueprint' && e.label === label) out.push(e.path)
                if (e.kind === 'book' && recursive && e.children) walk(e.children)
            }
        }
        walk(this.entries())
        return out
    }

    /**
     * The path of the blueprint labelled `label`, or undefined if none is.
     * Unless `unique` is false, a label more than one blueprint carries throws
     * AmbiguousLabelError naming all of them, so a script never quietly gets
     * the wrong one; with `unique: false` the first in slot order wins.
     */
    public findByLabel(
        label: string,
        opts: FindOptions & { unique?: boolean } = {}
    ): number[] | undefined {
        const found = this.findAllByLabel(label, opts)
        if (found.length > 1 && opts.unique !== false) throw new AmbiguousLabelError(label, found)
        return found[0]
    }

    /**
     * An independent copy of the blueprint at `path`: changing it changes
     * nothing in the book, and which blueprint the editor has open stays as
     * it was. Throws BookPathError if the path holds no blueprint.
     */
    public getBlueprint(path: readonly number[]): Blueprint {
        this.saveActiveBlueprint()
        const { entry } = this.entryAt(path, 'blueprint')
        return new Blueprint(deepCopy(need(entry, 'blueprint')))
    }

    /** Replaces the blueprint at `path` with a copy of `bp`. Only a blueprint can be replaced. */
    public setBlueprint(path: readonly number[], bp: Blueprint): void {
        this.saveActiveBlueprint()
        const { entry } = this.entryAt(path, 'blueprint')
        entry.blueprint = deepCopy(bp.serialize())
        // If that was the open blueprint, the open copy is now outdated and
        // must not be saved over the replacement; it is reopened on demand.
        if (samePath(path, this.activePath())) this._active = undefined
    }

    /**
     * Adds a copy of `bp` to the book, or to the nested book at `into`, in
     * the lowest free slot or in `slot`. Answers its path. A taken slot throws.
     */
    public addBlueprint(bp: Blueprint, opts: AddOptions = {}): number[] {
        return this.addEntry({ blueprint: deepCopy(bp.serialize()) }, opts)
    }

    /** Adds an empty book labelled `label`, like addBlueprint, and answers its path. */
    public addBook(label: string, opts: AddOptions = {}): number[] {
        return this.addEntry(
            {
                blueprint_book: {
                    item: 'blueprint-book',
                    version: getFactorioVersion(),
                    active_index: 0,
                    blueprints: [],
                    label,
                },
            },
            opts
        )
    }

    private addEntry(content: Omit<IBlueprintBookEntry, 'index'>, opts: AddOptions): number[] {
        this.saveActiveBlueprint()
        const into = opts.into ?? []
        const entries =
            into.length === 0
                ? this.blueprints
                : (need(this.entryAt(into, 'book').entry, 'blueprint_book').blueprints ??= [])
        // Pin every slot first: an entry without an index takes its position.
        entries.forEach((e, i) => (e.index = slotOf(e, i)))
        const taken = new Set(entries.map(e => e.index))
        let slot = opts.slot
        if (slot === undefined) {
            slot = 0
            while (taken.has(slot)) slot += 1
        } else if (taken.has(slot)) {
            throw new BookPathError([...into, slot], `slot ${slot} is taken`)
        }
        const at = entries.findIndex(e => e.index > (slot as number))
        entries.splice(at === -1 ? entries.length : at, 0, { index: slot, ...content })
        // Flattened indices behind the new entry moved; follow the open one.
        this._activeIndex = resolveActiveIndex(this.blueprints, this.activeSlot)
        return [...into, slot]
    }

    /** The slot path of the open blueprint, or undefined when none is. */
    private activePath(): number[] | undefined {
        const path: number[] = []
        let entries = this.blueprints
        let slot = this.activeSlot
        for (;;) {
            const position = positionOfSlot(entries, slot)
            if (position === -1) return undefined
            path.push(slot)
            const { blueprint, blueprint_book } = entries[position]
            if (blueprint) return path
            if (!blueprint_book) return undefined
            entries = blueprint_book.blueprints ?? []
            slot = blueprint_book.active_index ?? 0
        }
    }

    /** The entry at `path`, which must hold a `want`; BookPathError otherwise. */
    private entryAt(
        path: readonly number[],
        want: 'blueprint' | 'book'
    ): { entry: IBlueprintBookEntry } {
        if (path.length === 0) throw new BookPathError(path, 'an empty path names no entry')
        let entries = this.blueprints
        for (let depth = 0; depth < path.length; depth++) {
            const slot = path[depth]
            const position = positionOfSlot(entries, slot)
            const here = path.slice(0, depth + 1)
            if (position === -1) throw new BookPathError(here, `nothing is in slot ${slot}`)
            const entry = entries[position]
            const last = depth === path.length - 1
            const kind = entryKind(entry)
            const expected = last ? want : 'book'
            if (kind !== expected) {
                throw new BookPathError(
                    here,
                    `slot ${slot} holds ${KIND_NAMES[kind]}, not ${KIND_NAMES[expected]}`
                )
            }
            if (last) return { entry }
            entries = need(entry, 'blueprint_book').blueprints ?? []
        }
        throw new BookPathError(path, 'unreachable')
    }

    public get lastBookIndex(): number {
        return countNestedBlueprints(this.blueprints) - 1
    }

    /** Writes the open blueprint back into the book; answers the slot active_index names. */
    private saveActiveBlueprint(): number {
        if (!this._active) return this.activeSlot

        if (this._activeIndex === undefined) {
            /*
                The empty view. Anything done in it - entities, tiles, even just
                a name - becomes a new blueprint in the active slot; left as it
                opened, the book is not touched at all.
            */
            const data = this._active.serialize()
            if (sameIgnoringVersion(data, new Blueprint().serialize())) return this.activeSlot
            this.activeSlot = placeNewBlueprint(this.blueprints, this.activeSlot, data)
            this._activeIndex = resolveActiveIndex(this.blueprints, this.activeSlot)
            return this.activeSlot
        }

        const res = saveBlueprint(this.blueprints, this._activeIndex, this._active.serialize())
        if (!res.saved) {
            // The index came from this book, so it always lands on a blueprint.
            throw new Error(`Book: no blueprint at flattened index ${this._activeIndex}`)
        }
        this.activeSlot = res.index
        return res.index
    }

    public selectBlueprint(index?: number): Blueprint {
        this.saveActiveBlueprint()

        if (index !== undefined) {
            const inRange = index >= 0 && index <= this.lastBookIndex
            // An index past the end falls back to the first blueprint, or to the
            // empty view when the book holds none.
            this._activeIndex = inRange ? index : this.lastBookIndex >= 0 ? 0 : undefined
        }

        const bp =
            this._activeIndex === undefined
                ? new Blueprint()
                : new Blueprint(
                      getBlueprintAtFlattenedActiveIndex(this.blueprints, this._activeIndex)
                  )
        this._active = bp
        return bp
    }

    public serialize(): IBlueprintBook {
        const activeIndex = this.saveActiveBlueprint()

        return {
            // Keep each entry's slot: slots can have gaps, and active_index names a slot.
            blueprints: this.blueprints.map((v, position) => ({
                ...v,
                index: slotOf(v, position),
            })),
            item: 'blueprint-book',
            active_index: activeIndex,
            version: getFactorioVersion(),
            label: this.m_label,
            description: this.m_description,
            icons: this.icons,
        }
    }
}

/** What a book entry is. */
export type BookEntryKind = 'blueprint' | 'book' | 'upgrade-planner' | 'deconstruction-planner'

/** One entry of Book.entries(). */
export interface BookEntryInfo {
    /** Slots from the top-level book down to this entry. */
    path: number[]
    kind: BookEntryKind
    label?: string
    description?: string
    /** A nested book's own entries. */
    children?: BookEntryInfo[]
}

/** Options for Book.findByLabel and Book.findAllByLabel. */
export interface FindOptions {
    /** Search nested books too. Default true. */
    recursive?: boolean
    /** Include entries labelled with a leading '#', and their contents. Default false. */
    includeHidden?: boolean
}

/** Options for Book.addBlueprint and Book.addBook. */
export interface AddOptions {
    /** Path of the nested book to add to; the top-level book by default. */
    into?: readonly number[]
    /** The slot to use; the lowest free one by default. */
    slot?: number
}

const KIND_NAMES: Record<BookEntryKind, string> = {
    blueprint: 'a blueprint',
    book: 'a book',
    'upgrade-planner': 'an upgrade planner',
    'deconstruction-planner': 'a deconstruction planner',
}

function entryKind(entry: IBlueprintBookEntry): BookEntryKind {
    if (entry.blueprint) return 'blueprint'
    if (entry.blueprint_book) return 'book'
    return entry.upgrade_planner ? 'upgrade-planner' : 'deconstruction-planner'
}

function samePath(a: readonly number[], b: readonly number[] | undefined): boolean {
    return b !== undefined && a.length === b.length && a.every((v, i) => v === b[i])
}

function deepCopy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function describeEntries(entries: IBlueprintBookEntry[], prefix: number[]): BookEntryInfo[] {
    return entries.map((entry, position) => {
        const path = [...prefix, slotOf(entry, position)]
        const { blueprint, blueprint_book, upgrade_planner, deconstruction_planner } = entry
        if (blueprint) {
            return {
                path,
                kind: 'blueprint',
                label: blueprint.label,
                description: blueprint.description,
            }
        }
        if (blueprint_book) {
            return {
                path,
                kind: 'book',
                label: blueprint_book.label,
                description: blueprint_book.description,
                children: describeEntries(blueprint_book.blueprints ?? [], path),
            }
        }
        const planner = (upgrade_planner ?? deconstruction_planner ?? {}) as {
            label?: string
            description?: string
        }
        return {
            path,
            kind: upgrade_planner ? 'upgrade-planner' : 'deconstruction-planner',
            label: planner.label,
            description: planner.description,
        }
    })
}

function sameIgnoringVersion(a: IBlueprint, b: IBlueprint): boolean {
    return JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 })
}

/*
    A book entry's `index` is the slot it occupies in the game's book GUI, not
    its position in the array: slots can have gaps (0, 3, 7), and the book's
    `active_index` names a slot. An entry without an index - hand-built JSON -
    falls back to its array position.
*/
function slotOf(entry: IBlueprintBookEntry, position: number): number {
    return typeof entry.index === 'number' ? entry.index : position
}

/** The array position of the entry in slot `slot`, or -1 if no entry occupies it. */
function positionOfSlot(bps: IBlueprintBookEntry[], slot: number): number {
    return bps.findIndex((entry, position) => slotOf(entry, position) === slot)
}

function countNestedBlueprints(bps: IBlueprintBookEntry[] = [], includePlanners = false): number {
    return bps.reduce((count, { blueprint, blueprint_book }) => {
        if (blueprint_book) {
            return count + countNestedBlueprints(blueprint_book.blueprints, includePlanners)
        } else if (blueprint || includePlanners) {
            return count + 1
        } else {
            return count
        }
    }, 0)
}

/**
 * The flattened index of the blueprint the `active_index` chain ends on, or
 * undefined where it ends on no blueprint: an empty slot, a planner, or a
 * nested book whose own active slot holds none.
 */
function resolveActiveIndex(bps: IBlueprintBookEntry[], activeSlot: number): number | undefined {
    const position = positionOfSlot(bps, activeSlot)
    if (position === -1) return undefined
    const { blueprint, blueprint_book } = bps[position]
    const before = countNestedBlueprints(bps.slice(0, position))
    if (blueprint) return before
    if (!blueprint_book) return undefined
    const inner = resolveActiveIndex(
        blueprint_book.blueprints ?? [],
        blueprint_book.active_index ?? 0
    )
    return inner === undefined ? undefined : before + inner
}

/**
 * Puts a new blueprint where the `active_index` chain ends and answers the
 * top-level slot it went into. An empty slot takes it; a nested book passes it
 * on to its own active slot; a slot a planner occupies stays the planner's,
 * and the blueprint takes the lowest free slot of that book instead.
 */
function placeNewBlueprint(bps: IBlueprintBookEntry[], activeSlot: number, bp: IBlueprint): number {
    const position = positionOfSlot(bps, activeSlot)
    if (position !== -1) {
        const book = bps[position].blueprint_book
        if (book) {
            book.blueprints ??= []
            book.active_index = placeNewBlueprint(book.blueprints, book.active_index ?? 0, bp)
            return activeSlot
        }
    }
    // Pin every entry's slot first: one without an `index` takes its array
    // position, which the insertion below would otherwise shift.
    bps.forEach((e, i) => (e.index = slotOf(e, i)))
    let slot = activeSlot
    if (position !== -1) {
        const taken = new Set(bps.map((e, i) => slotOf(e, i)))
        slot = 0
        while (taken.has(slot)) slot += 1
    }
    // Kept in slot order, which is the order the flattened indices count in.
    const at = bps.findIndex((e, i) => slotOf(e, i) > slot)
    bps.splice(at === -1 ? bps.length : at, 0, { index: slot, blueprint: bp })
    return slot
}

/**
 * The blueprint at flattened index `index`, or undefined where the index does
 * not land on one - `selectBlueprint` feeds the answer straight to the
 * `Blueprint` constructor, whose parameter is optional, so undefined degrades
 * to an empty blueprint rather than throwing.
 */
function getBlueprintAtFlattenedActiveIndex(
    bps: IBlueprintBookEntry[],
    index: number
): IBlueprint | undefined {
    const search = (bps: IBlueprintBookEntry[] = [], index: number): number | IBlueprint => {
        let i = index
        for (const { blueprint, blueprint_book } of bps) {
            if (blueprint) {
                if (i === 0) return blueprint
                i -= 1
            } else if (blueprint_book) {
                const ret = search(blueprint_book.blueprints, i)
                if (typeof ret === 'number') {
                    i = ret
                } else {
                    return ret
                }
            }
        }
        return i
    }

    const ret = search(bps, index)
    return typeof ret === 'number' ? undefined : ret
}

/**
 * The outcome of searching a book's entries for a flattened index. Exactly one
 * of the two cases holds, which the `[number, number]` tuple this replaces could
 * not say: it carried the answer in whichever slot was not undefined, and the
 * recursive call read `newI === undefined` to mean "saved" - a meaning nothing
 * in the type mentioned.
 */
type SaveResult =
    /** Written into the entry occupying slot `index` of these entries. */
    | { saved: true; index: number }
    /** Not in these entries; `remaining` blueprints of the search index are left to skip. */
    | { saved: false; remaining: number }

function saveBlueprint(bps: IBlueprintBookEntry[] = [], index: number, bp: IBlueprint): SaveResult {
    let i = index
    for (let j = 0; j < bps.length; j++) {
        const { blueprint, blueprint_book } = bps[j]
        if (blueprint) {
            if (i === 0) {
                bps[j].blueprint = bp
                return { saved: true, index: slotOf(bps[j], j) }
            }
            i -= 1
        } else if (blueprint_book) {
            const res = saveBlueprint(blueprint_book.blueprints, i, bp)
            if (res.saved) {
                blueprint_book.active_index = res.index
                return { saved: true, index: slotOf(bps[j], j) }
            }
            i = res.remaining
        }
    }
    return { saved: false, remaining: i }
}

export { Book }
