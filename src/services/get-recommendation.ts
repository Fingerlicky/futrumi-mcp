import { gqlRequest } from "../graphql-client.js";
import { RECOMMENDATION_QUERY } from "../queries.js";
import type { RecommendationDetail } from "../types.js";

export interface GetRecommendationInput {
  recommendation_id: string;
}

export async function getRecommendation(
  input: GetRecommendationInput,
): Promise<RecommendationDetail> {
  const data = await gqlRequest<{ recommendation: RecommendationDetail }>(RECOMMENDATION_QUERY, {
    id: input.recommendation_id,
  });
  return data.recommendation;
}
