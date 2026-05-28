import { gqlRequest } from "../graphql-client.js";
import { EXPERT_QUERY } from "../queries.js";
import { searchRecommendations } from "./search-recommendations.js";
import type { ExpertDetail, RecommendationListItem } from "../types.js";

const CZ_CENTER = { latitude: 49.8, longitude: 15.5 };
const CZ_RADIUS_METERS = 350_000;

export interface GetExpertInput {
  expert_id: string;
  limit?: number;
}

export interface GetExpertResult {
  expert: ExpertDetail;
  recommendations: RecommendationListItem[];
}

export async function getExpert(input: GetExpertInput): Promise<GetExpertResult> {
  const [expertData, recommendations] = await Promise.all([
    gqlRequest<{ expert: ExpertDetail }>(EXPERT_QUERY, { id: input.expert_id }),
    searchRecommendations({
      latitude: CZ_CENTER.latitude,
      longitude: CZ_CENTER.longitude,
      radiusMeters: CZ_RADIUS_METERS,
      expert_id: input.expert_id,
      limit: input.limit ?? 30,
    }),
  ]);

  return {
    expert: expertData.expert,
    recommendations: recommendations.recommendations,
  };
}
