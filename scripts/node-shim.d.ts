// Minimal declarations of the Node APIs the scripts use, so `npm run typecheck`
// covers scripts/ without @types/node (which this project does not install).
// Loose on purpose: only the members the scripts call, with the shapes they rely on.
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  execPath: string
  exit(code?: number): never
}
declare class Buffer {
  toString(encoding?: string): string
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function existsSync(path: string): boolean
}
declare module 'node:path' {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
  export function dirname(path: string): string
  export const sep: string
}
declare module 'node:os' {
  export function availableParallelism(): number
  export function tmpdir(): string
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string
}
declare module 'node:net' {
  interface Server {
    once(event: 'error', listener: (err: Error) => void): void
    listen(port: number, host: string, listener: () => void): void
    address(): { port: number } | string | null
    close(listener?: () => void): void
  }
  export function createServer(): Server
}
declare module 'node:child_process' {
  interface Readable {
    on(event: 'data', listener: (chunk: Buffer) => void): void
  }
  interface ChildProcess {
    stdout: Readable
    stderr: Readable
    exitCode: number | null
    kill(signal?: string): boolean
    once(event: 'exit', listener: () => void): void
  }
  export function spawn(command: string, args: string[], options: { cwd: string; stdio: string[] }): ChildProcess
}
declare module 'node:worker_threads' {
  export const isMainThread: boolean
  export const workerData: unknown
  export const parentPort: { postMessage(value: unknown): void } | null
  export class Worker {
    constructor(file: URL, options: { workerData: unknown; argv: string[] })
    once(event: 'message', listener: (value: never) => void): void
    once(event: 'error', listener: (err: Error) => void): void
  }
}
