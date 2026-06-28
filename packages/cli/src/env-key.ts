export const envKey = (prefix: string, name: string) =>
  `${prefix}_${name.toUpperCase().replace(/-/g, '_')}`
