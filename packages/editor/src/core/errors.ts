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
