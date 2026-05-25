import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gqlRequest } from "../graphql-client.js";
import { BUSINESS_QUERY } from "../queries.js";
import { formatBusinessDetail } from "../formatters.js";
import type { BusinessDetail } from "../types.js";

const inputSchema = {
  business_id: z.string().min(1).describe("Business id (the `id` value returned by search/find tools)."),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe("Optional. User location — populates the distance field on the response."),
  longitude: z.number().min(-180).max(180).optional(),
};

export function registerGetBusiness(server: McpServer) {
  server.registerTool(
    "get_business",
    {
      title: "Get full business detail",
      description:
        "Return full details for a single business: address, opening hours, web/menu/phone/social links, featured quotes, and every expert recommendation about it. Use when the user is zeroing in on one place.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const variables: Record<string, unknown> = { id: args.business_id };
      if (typeof args.latitude === "number" && typeof args.longitude === "number") {
        variables.location = { latitude: args.latitude, longitude: args.longitude };
      }
      const data = await gqlRequest<{ business: BusinessDetail }>(BUSINESS_QUERY, variables);
      return {
        content: [{ type: "text", text: formatBusinessDetail(data.business) }],
      };
    },
  );
}
