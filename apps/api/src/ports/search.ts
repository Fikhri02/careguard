export interface SearchResult {
  title: string;
  url: string;
  text?: string;
}

export interface Search {
  /** Resolves [] on any failure. Never throws. */
  search(query: string, numResults: number): Promise<SearchResult[]>;
}
