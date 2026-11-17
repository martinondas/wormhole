// Bundles scripts/<name>.ts with esbuild (the sources use extensionless imports that
// bare node cannot resolve) and runs the bundle under node with the remaining
// arguments: node scripts/run.mjs <name> [args]
import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'

const [name, ...args] = process.argv.slice(2)
const outfile = `.cache/${name}.mjs`
buildSync({
  entryPoints: [`scripts/${name}.ts`],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['playwright'],
  logLevel: 'warning',
  outfile,
})
process.exit(spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' }).status ?? 1)
