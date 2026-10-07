import { buildRebaseSql } from "./rebase.ts";

process.stdout.write(buildRebaseSql(Date.now()));
