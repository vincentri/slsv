export const GONE_RE = /(NotFound|NoSuch|DoesNotExist|NonExistent)/i;

export const isGone = (e: any): boolean => GONE_RE.test(e?.name ?? String(e));

export const isAlreadyExists = (e: any): boolean =>
  /(AlreadyExists|AlreadyExist|QueueNameExists)/i.test(e?.name ?? String(e));
