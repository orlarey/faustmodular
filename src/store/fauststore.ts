/*				FAUSTSTORE.TS
    The library of the stores, shared by faustmodular and faustcode (spec_files_store.md of faustcode, « Le code
    commun »): the modules of src/store without an interface (addresses and paths, the index and the git blobs,
    reading and publishing through the API of GitHub, the followed stores and the tokens, the plan of a scene), and
    the identity of a code. Built by `npm run build:fauststore` into lib/fauststore.js, an ES module without
    dependency, that faustcode keeps a copy of (webapp/vendor/fauststore/).
*/

export const FAUSTSTORE_VERSION = "1.3.0";

export * from "./StoreFormat";
export * from "./StoreIndex";
export * from "./StoreReader";
export * from "./StorePublisher";
export * from "./Stores";
export * from "./Publishing";
export * from "./StoreLink";
export * from "./ScenePlan";
export * from "./Recall";
export { sha1, normalizeText } from "../documents/Sha1";
export { wrapModuleCode, unwrapModuleCode, userCode } from "../model/ModuleCode";
