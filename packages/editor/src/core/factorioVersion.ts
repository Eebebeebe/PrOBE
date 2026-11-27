// this is how it works in factorio but js doesn't support 64bit bitwise operations
//  uint64_t(developerVersion) |
// (uint64_t(minorVersion) << 16) |
// (uint64_t(majorVersion) << 32) |
// (uint64_t(mainVersion) << 48)
//
// Lives on its own rather than in Blueprint.ts so nameMigrations.ts can compare
// versions without pulling FD - and the whole entity model behind it - into a
// unit test.
//
// Multiplying instead of shifting keeps every part exact: the result stays
// below 2^53, the largest whole number a JS number holds without rounding.
// (This used to multiply by 0xffffffff, one less than 2^32, which quietly
// wrote 2.0.45 as 2.0.43.)
const getFactorioVersion = (main = 2, major = 0, minor = 45): number =>
    main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16

export { getFactorioVersion }
