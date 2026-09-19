// Node 18 has Web Crypto as `require("crypto").webcrypto`, not global `crypto`
// (global crypto is unflagged from Node 19). Windows 8.1 ships Node 18.20.8.
import { webcrypto } from "node:crypto";

const runtime = globalThis as typeof globalThis & { crypto?: Crypto };
if (typeof runtime.crypto === "undefined" || typeof runtime.crypto.getRandomValues !== "function") {
  runtime.crypto = webcrypto as Crypto;
}
