/**
 * POST /v1/systemone — TypeSafe System One decision API.
 *
 * Models: `jev`, `clef` (bare names expand to their `-latest` alias; the endpoint defaults to
 * `jev-latest`). The body is forwarded verbatim: `{ state, questions: { <name>: { type, … } } }`.
 * Docs: https://docs.typesafe.ai/api
 */
import {
  makeTypesafeDecisionPost,
  typesafeDecisionOptions,
} from "@/app/api/v1/_shared/typesafeDecision";

export const OPTIONS = typesafeDecisionOptions;
export const POST = makeTypesafeDecisionPost("systemone");
