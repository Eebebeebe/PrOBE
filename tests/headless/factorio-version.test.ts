import { describe, expect, it } from 'vite-plus/test'
import { getFactorioVersion } from '../../packages/editor/src/core/factorioVersion'

/*
    Factorio packs a version into one 64-bit number, 16 bits per part:
    main << 48 | major << 32 | minor << 16 | developer. The game reads the
    number back the same way, so what the editor writes must decode to the
    version it means. Decoded here with BigInt so the check does not share
    the arithmetic it is checking.
*/
const decode = (v: number) => {
    const b = BigInt(v)
    return [b >> 48n, (b >> 32n) & 0xffffn, (b >> 16n) & 0xffffn, b & 0xffffn].map(Number)
}

describe('getFactorioVersion', () => {
    it('encodes each part in its own 16 bits', () => {
        expect(decode(getFactorioVersion(2, 0, 45))).toEqual([2, 0, 45, 0])
        expect(decode(getFactorioVersion(2, 1, 25))).toEqual([2, 1, 25, 0])
        expect(decode(getFactorioVersion(1, 1, 11))).toEqual([1, 1, 11, 0])
        expect(decode(getFactorioVersion(0, 17, 0))).toEqual([0, 17, 0, 0])
    })

    it('matches a version number the game itself wrote', () => {
        // tests/__fixtures__/books/basic-builder.txt, exported by 2.1.25. The
        // game also fills the lowest 16 bits (here 10), which the editor does
        // not; everything above them must match.
        const written = 562954250027018
        expect(decode(written)).toEqual([2, 1, 25, 10])
        expect(getFactorioVersion(2, 1, 25)).toBe(written - 10)
    })

    // Up to 31.x.x; 32.0.0 would need 54 bits. Factorio is on 2.
    it('is an exact integer', () => {
        expect(Number.isSafeInteger(getFactorioVersion(31, 65535, 65535))).toBe(true)
    })
})
