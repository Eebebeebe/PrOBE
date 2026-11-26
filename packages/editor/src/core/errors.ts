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
