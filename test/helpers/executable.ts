import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CaptureExecutable {
  path: string
  payloadPath: string
}

export async function createExecutable(dir: string, name: string, script = '#!/bin/sh\n'): Promise<string> {
  const executablePath = join(dir, name)
  await writeFile(executablePath, script)
  await chmod(executablePath, 0o755)
  return executablePath
}

/** Create an executable that writes its STDIN to a file for later checks. */
export async function createCaptureExecutable(dir: string, name: string): Promise<CaptureExecutable> {
  const payloadPath = join(dir, `${name}.payloads`)
  const executablePath = await createExecutable(
    dir,
    name,
    `#!/bin/sh
cat >> ${shellQuote(payloadPath)}
printf '\n' >> ${shellQuote(payloadPath)}
`,
  )
  return { path: executablePath, payloadPath }
}

function shellQuote(value: string): string {
  // These paths are embedded into a generated shell script. Quote them so
  // temp directory names with spaces, apostrophes, or shell metacharacters are
  // treated as literal file paths instead of script syntax.
  return `'${value.replaceAll("'", "'\\''")}'`
}
