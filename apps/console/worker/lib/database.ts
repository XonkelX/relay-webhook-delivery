export interface RelayStatement {
  bind(...values: unknown[]): RelayStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{
    results: T[]
  }>
  run(): Promise<unknown>
}

export interface RelayDatabase {
  prepare(query: string): RelayStatement
  batch(statements: RelayStatement[]): Promise<unknown[]>
}
