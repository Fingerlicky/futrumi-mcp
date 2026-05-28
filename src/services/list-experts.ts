import { gqlRequest } from "../graphql-client.js";
import { EXPERTS_QUERY } from "../queries.js";
import type { ExpertListItem } from "../types.js";

export interface ListExpertsInput {
  pageNumber?: number;
  pageSize?: number;
}

export interface ListExpertsResult {
  experts: ExpertListItem[];
  total: number;
}

export async function listExperts(input: ListExpertsInput): Promise<ListExpertsResult> {
  const data = await gqlRequest<{
    experts: { total: number; edges: ExpertListItem[] };
  }>(EXPERTS_QUERY, {
    pagination: {
      pageNumber: input.pageNumber ?? 0,
      pageSize: input.pageSize ?? 20,
    },
  });
  return {
    experts: data.experts.edges,
    total: data.experts.total,
  };
}
