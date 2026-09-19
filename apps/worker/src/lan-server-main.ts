import "./node-crypto-polyfill";
import { createLanRuntime, parseCli } from "./node-lan-server";

const runtime = createLanRuntime(parseCli(process.argv.slice(2), process.env));
runtime.listen().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
