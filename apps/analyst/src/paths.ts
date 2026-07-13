import { fileURLToPath } from "node:url";

/** Corpus dir (where the decision path writes `*.analyst.json`) and the read-model DB path. */
export const CORPUS_DIR = fileURLToPath(new URL("../../../corpus/", import.meta.url));
export const DB_PATH = process.env.ANALYST_DB_PATH ?? fileURLToPath(new URL("../../../corpus/analyst.db", import.meta.url));
