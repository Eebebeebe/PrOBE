/**
 * Entity types that cannot produce sprites today, and so render as a missing
 * sprite. Not an accepted cost - each is a real gap - but they predate the
 * sprite-generation tests. Shared by tests/sprite-generation.spec.ts (browser)
 * and tests/headless/sprite-generation.test.ts (Node).
 *
 * None of these is placeable in a real blueprint: three decorative logos, a
 * Fulgoran ruin and a hidden internal entity.
 */
export const EXPECTED_SPRITE_FAILURES: readonly string[] = [
    'factorio-logo-11tiles',
    'factorio-logo-16tiles',
    'factorio-logo-22tiles',
    'fulgoran-ruin-attractor',
    'hidden-electric-energy-interface',
]
