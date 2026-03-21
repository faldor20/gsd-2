import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createJiti } from '@mariozechner/jiti'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const jiti = createJiti(import.meta.url)

export async function importGsdResourceModule<T>(relativePath: string): Promise<T> {
  const modulePath = join(packageRoot, 'src', 'resources', 'extensions', 'gsd', relativePath)
  return await jiti.import(modulePath) as T
}
