export interface UrlReputation {
  /** true = known unsafe, false = checked and clean, null = could not check. */
  isUnsafe(url: string): Promise<boolean | null>;
}
