// Lets tests import SQL migration files as plain strings (Vite's `?raw` suffix).
declare module '*.sql?raw' {
  const sql: string
  export default sql
}
