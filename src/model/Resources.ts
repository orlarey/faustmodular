/*				RESOURCES.TS
    The resources of a scene (Documentation/SCENE-RESOURCES-SPEC.md): a resource is a name, a code and a
    provenance; the modules of the scene are instances of resources. The name of a resource is unique in
    the scene and is the name of the Faust group of its instances (R1): the addresses of their parameters
    begin with /<name>/.

    This module is pure: names, files, reuse, renaming of addresses, and the migration of the instances of
    a format 4 document (each with its own code) to resources.
*/

// Where a resource comes from: a delivered module, a user module at a version, a module of a store at a
// commit, or nowhere (dropped, written here).
export type Provenance =
    | { kind: "builtin"; path: string }
    | { kind: "user"; module: string; version: string }
    | { kind: "store"; store: string; path: string; commit: string }
    | { kind: "none" };

export interface Resource {
    name: string;
    code: string;           // the user's code (or its hash, in a stored document)
    wrapped: boolean;       // false: a code not wrapped in the group of its name (some 1.x files), compiled as it is
    provenance: Provenance;
}

export const NO_PROVENANCE: Provenance = { kind: "none" };

// The same origin, whatever its version: the same delivered module, user module or module of a store.
// Never for "none": two codes written here are two resources.
export function sameSource(a: Provenance, b: Provenance): boolean {
    if (a.kind == "builtin" && b.kind == "builtin") return a.path == b.path;
    if (a.kind == "user" && b.kind == "user") return a.module == b.module;
    if (a.kind == "store" && b.kind == "store") return a.store == b.store && a.path == b.path;
    return false;
}

// A name not taken: the name itself, or the name followed by -2, -3... ("VCO", "VCO-2").
export function uniqueName(name: string, taken: Iterable<string>): string {
    const names = new Set(taken);
    if (!names.has(name)) return name;
    for (let n = 2; ; n++) {
        const candidate = `${name}-${n}`;
        if (!names.has(candidate)) return candidate;
    }
}

// The file of a resource (resources/<file>): its name, the characters a file name cannot hold replaced
// by "_", and ".dsp"; unique among `taken` (compared without case: some file systems ignore it).
export function resourceFileName(name: string, taken: Iterable<string> = []): string {
    let base = name.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").trim() || "module";
    if (base == "." || base == "..") base = "_" + base;
    const used = new Set(Array.from(taken, (f) => f.toLowerCase()));
    let file = base + ".dsp";
    for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base}-${n}.dsp`;
    return file;
}

// The resource a module added to the scene can be an instance of: the same source and the same code.
export function findReusable(resources: Resource[], provenance: Provenance, code: string): Resource | undefined {
    return resources.find((r) => r.code == code && sameSource(r.provenance, provenance));
}

/******************** RENAMING ********************/
// The addresses of the parameters of an instance begin with the name of its group: /<name>/...

export function renameAddress(address: string, from: string, to: string): string {
    const prefix = `/${from}/`;
    return address.startsWith(prefix) ? `/${to}/` + address.slice(prefix.length) : address;
}

// The addressed parts of an instance (values, accelerometer, modulations), renamed with its group.
export interface Addressed {
    params: Record<string, number>;
    acc: Array<{ address: string }>;
    modulations?: Array<{ widget: string }>;
}

export function renameInstance<I extends Addressed>(instance: I, from: string, to: string): I {
    if (from == to) return instance;
    const params: Record<string, number> = {};
    for (const [address, value] of Object.entries(instance.params)) params[renameAddress(address, from, to)] = value;
    return {
        ...instance,
        params,
        acc: instance.acc.map((a) => ({ ...a, address: renameAddress(a.address, from, to) })),
        ...(instance.modulations ? { modulations: instance.modulations.map((m) => ({ ...m, widget: renameAddress(m.widget, from, to) })) } : {}),
    };
}

/******************** MIGRATION ********************/
// Format 4: each instance has its name and its code. Format 5: the instances of the same name and the
// same code share a resource; a name held by several codes becomes <name>-2, <name>-3... in the order of
// the ids of the instances, and their addresses are renamed with it. Each instance keeps its effective
// code, its group name aside.

export interface InstanceWithCode extends Addressed {
    id: string;
    name: string;
    code: string;
    wrapped: boolean;
}

export type InstanceOfResource<I extends InstanceWithCode> = Omit<I, "name" | "code" | "wrapped"> & { resource: string };

// The order of the ids: numbers by value, then the others by text.
export function compareIds(a: string, b: string): number {
    const na = /^\d+$/.test(a) ? Number(a) : NaN, nb = /^\d+$/.test(b) ? Number(b) : NaN;
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

export function migrateInstances<I extends InstanceWithCode>(
    instances: I[],
    provenanceOf: (code: string, wrapped: boolean, name: string) => Provenance = () => NO_PROVENANCE,
): { resources: Resource[]; instances: Array<InstanceOfResource<I>> } {
    const resources: Resource[] = [];
    const byKey = new Map<string, Resource>();
    const resourceOf = new Map<string, Resource>();         // instance id -> resource
    for (const instance of [...instances].sort((a, b) => compareIds(a.id, b.id))) {
        const key = JSON.stringify([instance.name, instance.code, instance.wrapped]);
        let resource = byKey.get(key);
        if (!resource) {
            resource = {
                name: uniqueName(instance.name, resources.map((r) => r.name)),
                code: instance.code,
                wrapped: instance.wrapped,
                provenance: provenanceOf(instance.code, instance.wrapped, instance.name),
            };
            resources.push(resource);
            byKey.set(key, resource);
        }
        resourceOf.set(instance.id, resource);
    }
    return {
        resources,
        instances: instances.map((instance) => {
            const resource = resourceOf.get(instance.id)!;
            // a code not wrapped keeps its own group: its addresses do not follow the name
            const renamed = instance.wrapped ? renameInstance(instance, instance.name, resource.name) : instance;
            const { name: _name, code: _code, wrapped: _wrapped, ...rest } = renamed;
            return { ...rest, resource: resource.name } as InstanceOfResource<I>;
        }),
    };
}

// The resources no instance uses (the family "This scene" shows them, to be removed).
export function unusedResources(resources: Resource[], instances: Array<{ resource: string }>): Resource[] {
    const used = new Set(instances.map((i) => i.resource));
    return resources.filter((r) => !used.has(r.name));
}
