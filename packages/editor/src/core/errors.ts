/*
    Errors the editor core throws. They live in core, not in containers/, so the
    core can throw them without importing the PixiJS rendering layer.
*/

/** Thrown when an entity that the game cannot mirror (train stops, rail signals) is flipped. */
export class IllegalFlipError extends Error {
    public constructor(message: string) {
        super(message)
        this.name = 'IllegalFlipError'
    }
}

/**
 * Thrown when text is set that the game would cut short. Factorio silently
 * truncates labels, descriptions and similar fields at a byte limit
 * (core/textLimits.ts), so writing longer text would lose its end without
 * anyone noticing; this says so at the moment it is set instead.
 */
export class TextTooLongError extends Error {
    public constructor(
        public readonly field: string,
        public readonly bytes: number,
        public readonly limit: number
    ) {
        super(`${field} is ${bytes} bytes (UTF-8); Factorio keeps only ${limit}`)
        this.name = 'TextTooLongError'
    }
}

/**
 * Thrown when an entity cannot be swapped for another in place - the game
 * would not allow it, or something set on it would be lost. The message says
 * which, in the words a script author can act on.
 */
export class IncompatibleUpgradeError extends Error {
    public constructor(
        public readonly from: string,
        public readonly to: string,
        public readonly reason: string
    ) {
        super(`Cannot turn ${from} into ${to}: ${reason}`)
        this.name = 'IncompatibleUpgradeError'
    }
}

/** Thrown for a recipe an entity cannot craft, or a recipe change that would lose its modules. */
export class InvalidRecipeError extends Error {
    public constructor(
        public readonly entity: string,
        public readonly recipe: string,
        public readonly reason: string
    ) {
        super(`${entity} cannot use recipe ${recipe}: ${reason}`)
        this.name = 'InvalidRecipeError'
    }
}

/** Thrown for a quality name that is not one a player can pick (normal ... legendary). */
export class InvalidQualityError extends Error {
    public constructor(public readonly quality: string) {
        super(`${quality} is not a quality`)
        this.name = 'InvalidQualityError'
    }
}

/** Thrown when a label asked for as unique belongs to more than one blueprint. */
export class AmbiguousLabelError extends Error {
    public constructor(
        public readonly label: string,
        public readonly paths: readonly (readonly number[])[]
    ) {
        const where = paths.map(p => p.join('.'))
        const list = `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}`
        super(`${paths.length} blueprints are labelled "${label}": slots ${list}`)
        this.name = 'AmbiguousLabelError'
    }
}

/** Thrown when a path into a book does not lead to what the call needs, or a slot is taken. */
export class BookPathError extends Error {
    public constructor(
        public readonly path: readonly number[],
        public readonly reason: string
    ) {
        super(`Book path ${path.length ? path.join('.') : '(empty)'}: ${reason}`)
        this.name = 'BookPathError'
    }
}

/** One entity or tile a paste could not place, and what is in its way. */
export interface PasteConflict {
    /** Entity or tile name from the pasted blueprint. */
    name: string
    /** Where it would have gone in the destination. */
    position: { x: number; y: number }
    /** What is there: "<name> at (x, y)", or the rule that refuses it. */
    blockedBy: string[]
}

/**
 * Thrown by a paste that collides with what is already there (the default,
 * onConflict: 'error'). Nothing was placed. The message names each pasted
 * entity that does not fit and what is in its way, as the game's own
 * "can't build here" does.
 */
export class CollisionError extends Error {
    public constructor(public readonly conflicts: readonly PasteConflict[]) {
        const shown = conflicts
            .slice(0, 3)
            .map(
                c =>
                    `${c.name} at (${c.position.x}, ${c.position.y}): ${c.blockedBy.join(', ')} in the way`
            )
        const more = conflicts.length > 3 ? `, and ${conflicts.length - 3} more` : ''
        super(`Cannot paste ${shown.join('; ')}${more}`)
        this.name = 'CollisionError'
    }
}

/** Thrown for a paste offset that would take entities off their grid. */
export class ParityError extends Error {
    public constructor(
        public readonly offset: { x: number; y: number },
        reason: string
    ) {
        super(`Cannot paste at offset (${offset.x}, ${offset.y}): ${reason}`)
        this.name = 'ParityError'
    }
}
