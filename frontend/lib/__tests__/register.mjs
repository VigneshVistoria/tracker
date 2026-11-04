// Lets Node's built-in test runner load the frontend's lib/ files as-is:
// they are ES modules that import each other without the ".js" extension
// (Next.js resolves that, plain Node does not). No test library needed.
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !specifier.endsWith('.js')) {
      return next(specifier + '.js', context);
    }
    throw err;
  }
}`));
