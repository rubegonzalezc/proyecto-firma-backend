/**
 * Doble en memoria del cliente de Supabase, con la parte del constructor de
 * consultas que usan los servicios del portal.
 *
 * Existe porque las reglas de OTP y de enlaces —caducidad, intentos, revocación—
 * son la puerta de entrada de los firmantes externos y no deberían probarse
 * solo contra mocks que devuelven lo que uno espera.
 */

type Row = Record<string, any>;

interface Filter {
  kind: 'eq' | 'is' | 'in' | 'ilike' | 'neq';
  column: string;
  value: any;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.kind === 'eq') return row[f.column] === f.value;
    if (f.kind === 'neq') return row[f.column] !== f.value;
    if (f.kind === 'is') return (row[f.column] ?? null) === f.value;
    if (f.kind === 'ilike') {
      // Solo se usa para comparar correos sin distinguir mayúsculas; el
      // comodín `%` de SQL no hace falta para eso.
      const pattern = String(f.value).replace(/%/g, '').toLowerCase();
      return String(row[f.column] ?? '').toLowerCase() === pattern;
    }
    return Array.isArray(f.value) && f.value.includes(row[f.column]);
  });
}

class InsertBuilder {
  private inserted: Row[] = [];

  constructor(
    private readonly db: SupabaseFake,
    private readonly table: string,
    payload: Row | Row[],
  ) {
    const list = Array.isArray(payload) ? payload : [payload];
    for (const row of list) {
      const stored = { id: row.id ?? crypto.randomUUID(), ...row };
      this.db.rows(table).push(stored);
      this.inserted.push(stored);
    }
  }

  select(_columns = '*') {
    return this;
  }

  async single() {
    return this.inserted.length === 1
      ? { data: this.inserted[0], error: null }
      : { data: null, error: { message: 'no single row' } };
  }

  then(onFulfilled: (value: { data: Row[]; error: null }) => any) {
    return Promise.resolve({ data: this.inserted, error: null }).then(onFulfilled);
  }
}

class QueryBuilder {
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private orderAsc = true;
  private limitTo: number | null = null;

  constructor(
    private readonly db: SupabaseFake,
    private readonly table: string,
    private readonly op: 'select' | 'update' | 'delete',
    private readonly payload?: Row,
    private readonly embed?: string,
  ) {}

  eq(column: string, value: any) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  is(column: string, value: any) {
    this.filters.push({ kind: 'is', column, value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ kind: 'in', column, value });
    return this;
  }

  ilike(column: string, value: string) {
    this.filters.push({ kind: 'ilike', column, value });
    return this;
  }

  /** `not('status', 'eq', 'voided')` — la única negación que usan los servicios. */
  not(column: string, operator: string, value: any) {
    if (operator !== 'eq') {
      throw new Error(`El doble de Supabase no implementa not(${operator})`);
    }
    this.filters.push({ kind: 'neq', column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(count: number) {
    this.limitTo = count;
    return this;
  }

  private resolve(): Row[] {
    const rows = this.db.rows(this.table).filter((r) => matches(r, this.filters));

    if (this.op === 'update') {
      for (const row of rows) Object.assign(row, this.payload);
      return rows;
    }
    if (this.op === 'delete') {
      this.db.remove(this.table, rows);
      return rows;
    }

    let result = [...rows];
    if (this.orderColumn) {
      const column = this.orderColumn;
      result.sort((a, b) => {
        const diff = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
        return this.orderAsc ? diff : -diff;
      });
    }
    if (this.limitTo !== null) result = result.slice(0, this.limitTo);

    // Une la relación embebida que piden los servicios: `select('*, tabla(*)')`.
    //
    // Se resuelven las dos direcciones. Uno-a-uno: la fila padre guarda la
    // clave foránea, que no siempre se llama `<tabla_en_singular>_id`
    // (signer_tokens apunta a envelope_signers por `signer_id`), así que se
    // busca la primera columna `_id` cuyo valor exista en la tabla embebida.
    // Uno-a-muchos: la clave la guardan los hijos y hay que devolver el array
    // —`envelopes` con sus `envelope_signers`—. Antes solo existía el primer
    // caso y el segundo devolvía un único hijo en silencio, que es peor que
    // fallar: las pruebas pasaban contra una forma que el cliente real no
    // produce nunca.
    if (this.embed) {
      const children = this.db.rows(this.embed);
      result = result.map((row) => {
        const fk = Object.keys(row).find(
          (key) => key.endsWith('_id') && children.some((child) => child.id === row[key]),
        );
        if (fk) return { ...row, [this.embed!]: children.find((c) => c.id === row[fk]) };

        const childFk = children
          .flatMap((child) => Object.keys(child))
          .find((key) => key.endsWith('_id') && children.some((child) => child[key] === row.id));

        return {
          ...row,
          [this.embed!]: childFk ? children.filter((child) => child[childFk] === row.id) : null,
        };
      });
    }

    return result;
  }

  async maybeSingle() {
    const rows = this.resolve();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.resolve();
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { message: 'no single row' } };
  }

  select(_columns?: string) {
    return this;
  }

  then(onFulfilled: (value: { data: Row[]; error: null }) => any) {
    return Promise.resolve({ data: this.resolve(), error: null }).then(onFulfilled);
  }
}

export class SupabaseFake {
  private tables = new Map<string, Row[]>();
  /** Fuerza un fallo de inserción, para probar colisiones de índice único. */
  public failNextInsert = false;

  readonly storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async (_path: string, _expires: number) => ({
        data: { signedUrl: 'https://example.com/file.pdf' },
        error: null,
      }),
      remove: async () => ({ error: null }),
    }),
  };

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  seed(table: string, rows: Row[]): void {
    this.tables.set(table, rows.map((r) => ({ ...r })));
  }

  remove(table: string, rows: Row[]): void {
    const remaining = this.rows(table).filter((r) => !rows.includes(r));
    this.tables.set(table, remaining);
  }

  from(table: string) {
    return {
      select: (columns = '*') => {
        const embedMatch = columns.match(/,\s*(\w+)\(/);
        return new QueryBuilder(this, table, 'select', undefined, embedMatch?.[1]);
      },
      insert: (payload: Row | Row[]) => {
        if (this.failNextInsert) {
          this.failNextInsert = false;
          const failed = {
            data: null,
            error: { message: 'duplicate key value violates unique constraint' },
          };
          return {
            select: () => ({
              single: async () => failed,
            }),
            then: (onFulfilled: (value: typeof failed) => unknown) =>
              Promise.resolve(failed).then(onFulfilled),
          };
        }
        return new InsertBuilder(this, table, payload);
      },
      update: (payload: Row) => new QueryBuilder(this, table, 'update', payload),
      delete: () => new QueryBuilder(this, table, 'delete'),
    };
  }

  /** Se pasa donde se espera un `SupabaseService`. */
  asService() {
    return { admin: this, documentsBucket: 'documents' } as any;
  }
}

/** ConfigService mínimo con los secretos que piden los servicios del portal. */
export function fakeConfig(values: Record<string, string>) {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Falta la configuración ${key}`);
      return values[key];
    },
  } as any;
}
