import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface TempDirectory {
  path: string

  clean(): Promise<void>
}

export async function createTempDirectory(): Promise<TempDirectory> {
  const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-peon-adapter-'))

  return {
    path: tempPath,
    async clean() {
      await fs.rm(tempPath, { recursive: true, force: true })
    },
  }
}
