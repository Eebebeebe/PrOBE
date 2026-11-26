/*
    The Entity accessors that tests/entity-accessors.spec.ts (browser) and
    tests/headless/entity-accessors.test.ts (Node) tally across the corpus.
    Both read the same fixed point, tests/__fixtures__/entity-accessors.json;
    see the spec for what the two lists mean and why they are split.
*/

/*
    Eleven accessors whose value set is open, so only the shape of what they
    answer can be pinned. Measured 2026-08-10 across the corpus: `filters` takes
    1018 distinct values, `recipe` 264, `combinatorConditions` 228. The three
    `accepted*` lists have few distinct values but enormous keys - one
    `acceptedFilters` value serializes to roughly 54,000 characters - and the
    only compact key for those is a hash, which names nothing when it moves.
*/
export const TALLIED_SHAPE = [
    'recipe',
    'filters',
    'trainStopColor',
    'station',
    'constantCombinatorFilters',
    'displayPanelIcon',
    'modules',
    'combinatorConditions',
    'acceptedRecipes',
    'acceptedModules',
    'acceptedFilters',
] as const

/*
    Fourteen accessors whose value set is small and closed, recorded exactly.

    This is issue #189. The four-bucket tally cannot see a value, so 0 and 9 both
    read as `value` - which is the structural reason #186's splitter bug survived
    a 578-blueprint corpus. Worse, eight of these are total functions (never
    undefined, never throwing, never an array), so their old tally was pinned at
    exactly entityCount and could not move at all.

    Measured maximum is 10 distinct values (`inserterStackSize`); the whole group
    is 52 fixture entries, replacing the 56 bucket numbers it used to occupy.

    `possibleRotations` is here despite being an array because its keys are short
    and readable, unlike the `accepted*` lists above. The line between the two
    lists is "small closed value set", which only measurement establishes - note
    `recipe` is a scalar and belongs in the other list.
*/
export const TALLIED_VALUES = [
    'directionType',
    'railLayer',
    'filterSlots',
    'splitterInputPriority',
    'splitterOutputPriority',
    'filterMode',
    'moduleSlots',
    'inserterStackSize',
    'possibleRotations',
    'canBeRotated',
    'maxWireDistance',
    'generateConnector',
    'assemblerHasFluidInputs',
    'mayCraftWithFluid',
] as const

export type Tally = { value: number; empty: number; nothing: number; threw: number }
export type Histogram = Record<string, number>

export interface AccessorTally {
    entityCount: number
    blueprintCount: number
    shape: Record<string, Tally>
    values: Record<string, Histogram>
}
