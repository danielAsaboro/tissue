import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Corpus dir (where the decision path writes `*.analyst.json`) and the read-model DB path. */
export const CORPUS_DIR = process.env.TISSUE_CORPUS_DIR
  ?? (process.cwd().endsWith("/tissue")
    ? resolve(process.cwd(), "corpus")
    : fileURLToPath(new URL("../../../corpus/", import.meta.url)));
export const DB_PATH = process.env.ANALYST_DB_PATH ?? resolve(CORPUS_DIR, "analyst.db");
