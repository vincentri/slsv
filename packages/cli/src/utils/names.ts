export function appStagePrefix(app: string, stage: string): string {
  return `${app}-${stage}`;
}

export function resourceName(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}

export function frontendBucketName(prefix: string): string {
  return `${prefix.toLowerCase()}-frontend`;
}

export function queueFullName(prefix: string, name: string, fifo?: boolean): string {
  return fifo ? `${prefix}-${name}.fifo` : `${prefix}-${name}`;
}
