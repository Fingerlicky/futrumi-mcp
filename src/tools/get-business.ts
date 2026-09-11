import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatBusinessDetail } from "../formatters.js";
import { getBusiness } from "../services/get-business.js";

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
        "Return full details for a single business: address, opening hours, web/menu/phone/social links, featured quotes, photos (venue, per-dish, and other expert photos), and every expert recommendation about it. Use when the user is zeroing in on one place or wants to see its photos.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const business = await getBusiness(args);
      return {
        content: [{ type: "text", text: formatBusinessDetail(business) }],
      };
    },
  );
}
