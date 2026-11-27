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
