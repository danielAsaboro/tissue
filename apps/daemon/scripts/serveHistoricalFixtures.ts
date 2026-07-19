import { historicalFixtureRoot, listenHistoricalFixtureServer } from "../src/ingest/historicalFixtureService.js";

const { origin } = await listenHistoricalFixtureServer();
console.log(`verified historical TxLINE replay listening at ${origin} from ${historicalFixtureRoot()}`);
