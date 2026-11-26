/*
    Settings the editor core reads while it edits a blueprint. They used to be
    read from the PixiJS BlueprintContainer through the `G` globals, which do not
    exist outside the browser editor. The editor UI writes them through its own
    setters (Editor.limitWireReach and so on); the scripting engine and tests set
    them directly.
*/
export class CoreSettings {
    /**
     * Refuse entity moves that would stretch a wire past its maximum reach, as
     * the game does. Off lets the editor move wired entities freely.
     */
    public limitWireReach = true
}

export const coreSettings = new CoreSettings()
