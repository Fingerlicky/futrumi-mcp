import { gqlRequest } from "../graphql-client.js";
import { BUSINESS_QUERY } from "../queries.js";
import type { BusinessDetail } from "../types.js";

export interface GetBusinessInput {
  business_id: string;
  latitude?: number;
  longitude?: number;
}

export async function getBusiness(input: GetBusinessInput): Promise<BusinessDetail> {
  const variables: Record<string, unknown> = { id: input.business_id };
  if (typeof input.latitude === "number" && typeof input.longitude === "number") {
    variables.location = { latitude: input.latitude, longitude: input.longitude };
  }
  const data = await gqlRequest<{ business: BusinessDetail }>(BUSINESS_QUERY, variables);
  return data.business;
}
