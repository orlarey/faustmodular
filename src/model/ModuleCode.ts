/*				MODULECODE.TS
    The code of a module, as the playground stores it, is the user's code wrapped in a group named
    after the module:

        process = vgroup("<name>",environment{
        <user code>
        }.process);

    The group gives the module's parameters their addresses (/<name>/...), and the environment keeps
    the definitions of the user's code apart from those of the other modules in the exported program.
    Editors (the integrated one, faustcode) show and edit the user's code only.
*/

const WRAPPED = /^\s*process\s*=\s*vgroup\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*environment\s*\{([\s\S]*)\}\s*\.process\s*\)\s*;\s*$/;

// Wraps the user's code. The line breaks around it keep a final line comment from swallowing the
// closing brace.
export function wrapModuleCode(name: string, code: string): string {
    return `process = vgroup("${name.replace(/["\\]/g, "_")}",environment{\n${code}\n}.process);`;
}

// The name and the user's code of a wrapped module code; null if the code is not wrapped.
// unwrapModuleCode(wrapModuleCode(name, code)) gives back name and code (codes of the 1.x files,
// wrapped without line breaks, are given back as they are).
export function unwrapModuleCode(code: string): { name: string; code: string } | null {
    const match = WRAPPED.exec(code);
    if (!match) {
        return null;
    }
    return { name: match[1], code: match[2].replace(/^\n/, "").replace(/\n$/, "") };
}

// The user's code of a module (the whole code if it is not wrapped).
export function userCode(code: string): string {
    return unwrapModuleCode(code)?.code ?? code;
}

// Wraps edited user code like the module's current code: in the same group, so that the
// parameters keep their addresses (and values); as it is if the current code was not wrapped.
export function rewrapModuleCode(current: string, edited: string): string {
    const wrapped = unwrapModuleCode(current);
    return wrapped ? wrapModuleCode(wrapped.name, edited) : edited;
}

// Error of the compilation of a code wrapped by wrapModuleCode, with the line numbers of the user's
// code: libfaust reports "FaustDSP:<n>" in the wrapped code, one line below.
export function userError(error: string): string {
    return error.replace(/^Error:\s*/, "").replace(/FaustDSP:(\d+)/g, (_, n) => `line ${Math.max(1, Number(n) - 1)}`);
}
