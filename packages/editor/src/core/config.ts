/*
    Settings the editor core reads while it edits a blueprint. They used to be
    read from the PixiJS BlueprintContainer through the `G` globals, which do not
    exist outside the browser editor. The editor UI writes them through its own
    setters (Editor.limitWireReach and so on); the scripting engine and tests set
    them directly.
*/
/**
 * Where the core's diagnostics go: decode warnings, unknown prototypes, history
 * logging in debug mode, generator statistics. `console` satisfies it, and is
 * the default, so the browser editor logs exactly as before; the scripting
 * engine and tests swap in their own to capture or forward the messages.
 */
export interface CoreLogger {
    log(...data: unknown[]): void
    warn(...data: unknown[]): void
    clear(): void
}

export class CoreSettings {
    /**
     * Refuse entity moves that would stretch a wire past its maximum reach, as
     * the game does. Off lets the editor move wired entities freely.
     */
    public limitWireReach = true

    /** Debug mode: log decoded blueprint data and every history change. */
    public debug = false

    /** Receives every message the core would otherwise write to the console. */
    public logger: CoreLogger = console
}

export const coreSettings = new CoreSettings()
