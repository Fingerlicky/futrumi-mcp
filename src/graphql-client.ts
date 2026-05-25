import { GraphQLClient } from "graphql-request";

const DEFAULT_ENDPOINT = "https://futrumi-prod-w7u56.ondigitalocean.app/graphql";

export const graphqlEndpoint = process.env.FUTRUMI_GRAPHQL_URL?.trim() || DEFAULT_ENDPOINT;

export const gqlClient = new GraphQLClient(graphqlEndpoint, {
  headers: {
    "user-agent": "futrumi-mcp/0.1 (+https://futrumi.cz)",
  },
});

export async function gqlRequest<T>(
  document: string,
  variables: Record<string, unknown>,
): Promise<T> {
  return gqlClient.request<T>(document, variables);
}
