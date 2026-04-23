declare module "pg" {
  export interface QueryResult<T = unknown> {
    rows: T[];
  }

  export interface PoolConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean | { rejectUnauthorized?: boolean };
    max?: number;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T = unknown>(queryText: string, values?: unknown[]): Promise<QueryResult<T>>;
  }
}
