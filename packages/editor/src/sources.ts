import { Blueprint } from './core/Blueprint'
import { Book } from './core/Book'
import { decode } from './core/bpString'

/*
    Loading a blueprint from wherever the user points the editor: a blueprint
    string, or a link to one on pastebin, hastebin, a gist, gitlab,
    factorioprints, factorio.school, factoriobin or Google Docs.

    Links are fetched through the site's own /corsproxy, so this needs the
    website's server and is not part of the headless core; core/bpString.ts
    keeps only the pure decode/encode. /corsproxy still has no local
    implementation (see CLAUDE.md, Known issues).
*/

function getBlueprintOrBookFromSource(source: string): Promise<Blueprint | Book> {
    if (source === undefined) return Promise.resolve(new Blueprint())

    // trim whitespace
    const DATA = source.replace(/\s/g, '')

    let bpString
    if (DATA[0] === '0') {
        bpString = Promise.resolve(DATA)
    } else {
        bpString = new Promise<URL>((resolve, reject) => {
            const url = `https://${DATA.replace(/https?:\/\//g, '')}`
            try {
                resolve(new URL(url))
            } catch (e) {
                reject(e)
            }
        }).then((url: URL) => {
            console.log(`Loading data from: ${url}`)
            const pathParts = url.pathname.slice(1).split('/')

            const fetchData = (url: string): Promise<Response> =>
                fetch(`/corsproxy?url=${encodeURIComponent(url)}`).then(response => {
                    if (response.ok) return response
                    throw new Error('Network response was not ok.')
                })

            /*
                Dropbox is deliberately unsupported - see #98, closed wontfix, which
                records the probes. Two things a future handler would have to reckon
                with, neither obvious from the cases below: a share link is now
                `/scl/fi/<id>/<name>?rlkey=...`, and the `rlkey` is required, so the
                handler would have to preserve the incoming query string - every case
                here rebuilds from `pathParts` and throws the query away. And a link
                missing it answers the HTML login page at status 200, so the `ok`
                check above passes and the markup reaches decode() as a corrupt
                blueprint string. That second one is a property of fetchData rather
                than of Dropbox, and so applies to every source below.
            */
            switch (url.hostname.replace(/^www\./, '').split('.')[0]) {
                case 'pastebin':
                    return fetchData(`https://pastebin.com/raw/${pathParts[0]}`).then(r => r.text())
                case 'hastebin':
                    return fetchData(`https://hastebin.com/raw/${pathParts[0]}`).then(r => r.text())
                case 'gist':
                    return fetchData(`https://api.github.com/gists/${pathParts[1]}`)
                        .then(r => r.json())
                        .then(data => data.files[Object.keys(data.files)[0]].content)
                case 'gitlab':
                    return fetchData(`https://gitlab.com/${pathParts.join('/')}/raw`).then(r =>
                        r.text()
                    )
                case 'factorioprints':
                    return fetchData(
                        `https://facorio-blueprints.firebaseio.com/blueprints/${pathParts[1]}.json`
                    )
                        .then(r => r.json())
                        .then(data => data.blueprintString)
                case 'factorio': // factorio.school
                    if (pathParts[0] === 'api') {
                        return fetchData(url.href).then(r => r.text())
                    }

                    return fetchData(`https://www.factorio.school/api/blueprint/${pathParts[1]}`)
                        .then(r => r.json())
                        .then(data => data.blueprintString.blueprintString)
                // Factoriobin support added by wormeyman, originally by nyakokitsu (upstream PR #272)
                case 'factoriobin':
                    return fetchData(
                        `https://factoriobin.com/${pathParts.join('/')}/blueprint.txt`
                    ).then(r => r.text())
                case 'docs':
                    return fetchData(
                        `https://docs.google.com/document/d/${pathParts[2]}/export?format=txt`
                    ).then(r => r.text())
                default:
                    return fetchData(url.href).then(r => r.text())
            }
        })
    }

    return bpString.then(decode)
}

export { getBlueprintOrBookFromSource }
