/**
 * Import dinámico real en runtime. TypeScript con module=commonjs compila
 * `import()` a `require()`, lo que rompe módulos ESM como better-auth.
 */
export function importEsm<T = unknown>(specifier: string): Promise<T> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    value: string,
  ) => Promise<T>;

  return dynamicImport(specifier);
}
