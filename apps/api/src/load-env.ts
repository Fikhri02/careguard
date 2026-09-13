import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// npm workspaces run scripts from apps/api, so look there first, then at the repo root.
// Real environment variables always win (dotenv never overrides them).
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: [join(apiRoot, ".env"), join(apiRoot, "..", "..", ".env")], quiet: true });
