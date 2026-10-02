declare module "cloudflare:workers" {
  export const env: Record<string, any>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T=Record<string,unknown>>(): Promise<{results:T[]}>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql:string): D1PreparedStatement;
  batch(statements:D1PreparedStatement[]): Promise<unknown>;
}
interface Fetcher { fetch(request:Request):Promise<Response> }
