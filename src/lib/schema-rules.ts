/**
 * Re-export of the constraint list, for code that expects a TypeScript module.
 *
 * The list itself is schema-rules.mjs so that a plain Node script can import it without relying on
 * type stripping, which was experimental until 23.6. Everything here is re-exported unchanged; there is
 * no second copy to drift.
 */
export { TEXT_LIMITS, ENUMS, REQUIRED, NESTED, limitsForPrompt, violationsOf, repairable } from "./schema-rules.mjs";
