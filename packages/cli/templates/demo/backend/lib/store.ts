// Shared in-memory link store for the demo. Real apps swap this for db('links') / sql('...').
// ponytail: process-local Map — resets on cold start, not shared across Lambda instances.
export type Link = { id: string; url: string; createdAt: string };

export const store = new Map<string, Link>();

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function shortId() {
  let id = "";
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}
