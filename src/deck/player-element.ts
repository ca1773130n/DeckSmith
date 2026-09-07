/**
 * The side-effecting entry point: import this and the element is registered.
 *
 * Two lines, and a separate file on purpose. `player.ts` has no side effect at
 * import time, so it can be imported for its types or for `define(tag)` under a
 * different name; this is the one a `<script type="module" src="...">` reaches
 * for, where the whole point is that it registers itself.
 */
import { define } from "./player.js";

define();
