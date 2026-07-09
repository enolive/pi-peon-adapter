export interface RememberedEnv {
  restore(): void
}

export function rememberEnv(...names: string[]): RememberedEnv {
  const snapshot = new Map(names.map((name) => [name, process.env[name]]))

  return {
    restore() {
      for (const [name, value] of snapshot) {
        if (value === undefined) {
          delete process.env[name]
        } else {
          process.env[name] = value
        }
      }
    },
  }
}
