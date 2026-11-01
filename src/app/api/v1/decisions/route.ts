/**
 * POST /v1/decisions — TypeSafe Decisions API.
 *
 * Models: `gpt` (`gpt` and `gpt-latest` are accepted; the endpoint defaults to `gpt-latest`).
 * The body is forwarded verbatim to TypeSafe, so the question schema stays upstream-owned.
 */
import {
  makeTypesafeDecisionPost,
  typesafeDecisionOptions,
} from "@/app/api/v1/_shared/typesafeDecision";

export const OPTIONS = typesafeDecisionOptions;
export const POST = makeTypesafeDecisionPost("decisions");
