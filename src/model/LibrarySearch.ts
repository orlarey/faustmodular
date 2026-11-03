/*				LIBRARYSEARCH.TS
    The search of the Modules menu (Menu/Library.ts): the modules whose name, Faust functions, family,
    summary or description hold every word of the query, ignoring case and accents ("reverb zita", "écho").
    The results are ranked: the name first (beginning, then a word of it, then inside it), then the functions,
    then the family, then the text; equal ranks keep the order of the library.
*/

export interface Searchable {
    name: string;
    functions?: string[];
    family?: string;         // the label shown (translated), and its key
    familyKey?: string;
    summary?: string;
    description?: string;
}

// Lower case, without accents, and without what is not a letter or a digit at the ends of the words.
export function normalize(text: string): string {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function queryWords(query: string): string[] {
    return normalize(query).split(/[\s,;]+/).map((w) => w.trim()).filter((w) => w.length > 0);
}

// The rank of a word in a module (lower is better), or Infinity when the module does not hold it.
function wordRank(word: string, m: Searchable): number {
    const name = normalize(m.name);
    if (name.startsWith(word)) return 0;
    if (new RegExp("(^|[^a-z0-9])" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(name)) return 1;
    // a word of a name written in camel case or glued (ZitaRev, SineVCO)
    if (m.name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+/).some((part) => normalize(part).startsWith(word))) return 1;
    if (name.includes(word)) return 2;
    if ((m.functions ?? []).some((f) => normalize(f).includes(word))) return 3;
    if (normalize(m.family ?? "").includes(word) || normalize(m.familyKey ?? "").includes(word)) return 4;
    if (normalize(m.summary ?? "").includes(word) || normalize(m.description ?? "").includes(word)) return 5;
    return Infinity;
}

// The rank of a module for a query (the worst of its words), or Infinity when it does not match.
export function searchRank(query: string, m: Searchable): number {
    const words = queryWords(query);
    if (words.length == 0) return Infinity;
    let rank = 0;
    for (const word of words) {
        rank = Math.max(rank, wordRank(word, m));
        if (rank == Infinity) return Infinity;
    }
    return rank;
}

// The modules matching a query, ranked (a stable sort: the order of the library within a rank).
export function search<T extends Searchable>(query: string, modules: T[]): T[] {
    return modules
        .map((m, i) => ({ m, i, rank: searchRank(query, m) }))
        .filter((r) => r.rank < Infinity)
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map((r) => r.m);
}
