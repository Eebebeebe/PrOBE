import { TextTooLongError } from './errors'

/*
    Byte limits Factorio applies to text fields, counted in UTF-8 and silently
    cut beyond. Measured on 2.1.25 by tools/oracle/probe-text-limits.mjs
    (fixture: tools/oracle/fixtures/text-limits.json).
*/
export const TEXT_LIMITS = {
    /** Blueprint and blueprint book labels. */
    label: 200,
    /** Blueprint and blueprint book descriptions, combinator descriptions, display panel text. */
    description: 500,
    /** Train stop names. */
    station: 1024,
} as const

/** The length of `text` in UTF-8 bytes, the unit Factorio counts in. */
export function utf8Length(text: string): number {
    let bytes = 0
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0
        bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    }
    return bytes
}

/** Throws TextTooLongError when `text` is longer than Factorio keeps. */
export function checkTextLength(field: string, text: string, limit: number): void {
    const bytes = utf8Length(text)
    if (bytes > limit) throw new TextTooLongError(field, bytes, limit)
}
