// Node's type stripping does not rewrite the TypeScript ".js" import
// convention, so this hook retries a failed resolve against the ".ts" beside
// it. Scratch-only: it exists to load src/server/ui.ts without a build step.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.endsWith(".js")) return next(`${specifier.slice(0, -3)}.ts`, context);
    throw err;
  }
}
