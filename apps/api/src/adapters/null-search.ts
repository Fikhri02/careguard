import type { Search } from "../ports/search.js";

export const nullSearch: Search = { search: async () => [] };
