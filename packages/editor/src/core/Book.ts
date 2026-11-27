import { IBlueprint, IBlueprintBook, IBlueprintBookEntry, IIcon } from '../types'
import { Blueprint, getFactorioVersion } from './Blueprint'

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

    private readonly label?: string
    private readonly description?: string
    private readonly icons?: IIcon[]

    public constructor(data: IBlueprintBook) {
        if (data) {
            this.blueprints = data.blueprints || []
            this.activeSlot = data.active_index ?? 0
            this._activeIndex = resolveActiveIndex(this.blueprints, this.activeSlot)
            this.label = data.label
            this.description = data.description
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
            label: this.label,
            description: this.description,
            icons: this.icons,
        }
    }
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
