import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '@dealflow/db';

/**
 * A factory that returns query helpers automatically scoped to one organization.
 *
 * Every tenant-scoped table is expected to have an `organization_id` column.
 * Pass the column in via the helpers below; this is intentionally manual rather
 * than reflective, so missing the scope on a new table is a typecheck failure,
 * not a silent data leak.
 */
export class OrgScope {
  constructor(
    private readonly db: Database,
    public readonly organizationId: string,
  ) {}

  /** Returns a `where` clause that always restricts to this organization. */
  scope(orgColumn: PgColumn): SQL {
    return eq(orgColumn, this.organizationId);
  }

  /** Combine the org scope with additional conditions. */
  scopeAnd(orgColumn: PgColumn, ...rest: (SQL | undefined)[]): SQL {
    const filtered = rest.filter((c): c is SQL => Boolean(c));
    return and(this.scope(orgColumn), ...filtered)!;
  }

  /** Direct DB handle for queries that explicitly use `scope()`. */
  get rawDb(): Database {
    return this.db;
  }

  /** Cheap convenience to count rows matching the org scope. */
  async count<T extends PgTable>(table: T, orgColumn: PgColumn): Promise<number> {
    const result = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${this.scope(orgColumn)}`,
    );
    return result[0]?.count ?? 0;
  }
}

export function withOrg(db: Database, organizationId: string): OrgScope {
  return new OrgScope(db, organizationId);
}
