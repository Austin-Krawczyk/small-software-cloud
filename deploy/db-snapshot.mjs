// Consistent online snapshot of the SQLite database via VACUUM INTO — safe to
// run while the control plane holds the DB open (WAL mode).
//   node db-snapshot.mjs <source.db> <dest.db>
import { DatabaseSync } from "node:sqlite";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error("usage: node db-snapshot.mjs <source.db> <dest.db>");
  process.exit(1);
}
const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
db.close();
