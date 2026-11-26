/*
    The runtime globals the headless core uses. Browsers, Web Workers and Node
    (16+) all provide them, but without the DOM library TypeScript knows none of
    them, so tsconfig.core.json declares just these. Keeping the list explicit is
    the point: anything else the core reaches for (window, document, fetch, ...)
    fails to type-check there.

    Only tsconfig.core.json includes this file. The editor and website projects
    get the full declarations from the DOM library, which would clash with these.
*/
interface CoreConsole {
    log(...data: unknown[]): void
    warn(...data: unknown[]): void
    clear(): void
}
declare const console: CoreConsole
declare function atob(data: string): string
declare function btoa(data: string): string
