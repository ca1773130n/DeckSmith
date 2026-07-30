import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tsjs-hook.mjs", pathToFileURL(`${import.meta.dirname}/`));
