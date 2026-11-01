/*				VERSION.TS
    Name and version of the application, read from package.json at build time (single source).
    Shown in the header ("faustmodular x.y.z"), in the console and in the exported Faust code.
*/
import pkg from "../package.json";

export const APP_NAME: string = pkg.name;
export const APP_VERSION: string = pkg.version;
export const APP_TITLE = `${APP_NAME} ${APP_VERSION}`;
