import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import type { FunctionTool } from "openai/resources/live/live";

import { LIVE_TOOLS } from "./tools.js";

/**
 * Gemini takes the OpenAPI-flavoured `Schema`, not raw JSON Schema: types are
 * upper-case enum members, item counts are strings, and `additionalProperties`
 * does not exist. Tool definitions stay authored once in OpenAI's shape and are
 * translated here, so a new tool is never declared twice.
 */
const TYPE_BY_JSON_NAME: Record<string, Type> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  null: Type.NULL,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Schema.minItems/maxItems are int64 strings on the wire, unlike JSON Schema's numbers. */
const asCount = (value: unknown): string | undefined => {
  const parsed = asNumber(value);
  return parsed === undefined ? undefined : String(Math.trunc(parsed));
};

export function toGeminiSchema(input: unknown): Schema | undefined {
  if (!isRecord(input)) return undefined;

  const schema: Schema = {};

  if (typeof input.type === "string") {
    const mapped = TYPE_BY_JSON_NAME[input.type.toLowerCase()];
    if (mapped) schema.type = mapped;
  }
  if (typeof input.description === "string") schema.description = input.description;
  if (Array.isArray(input.enum)) {
    schema.enum = input.enum.filter((value): value is string => typeof value === "string");
  }
  if (typeof input.format === "string") schema.format = input.format;

  if (isRecord(input.properties)) {
    const properties: Record<string, Schema> = {};
    for (const [name, value] of Object.entries(input.properties)) {
      const converted = toGeminiSchema(value);
      if (converted) properties[name] = converted;
    }
    if (Object.keys(properties).length > 0) schema.properties = properties;
  }

  if (Array.isArray(input.required)) {
    const required = input.required.filter((value): value is string => typeof value === "string");
    if (required.length > 0) schema.required = required;
  }

  const items = toGeminiSchema(input.items);
  if (items) schema.items = items;

  const minimum = asNumber(input.minimum);
  if (minimum !== undefined) schema.minimum = minimum;
  const maximum = asNumber(input.maximum);
  if (maximum !== undefined) schema.maximum = maximum;

  const minItems = asCount(input.minItems);
  if (minItems !== undefined) schema.minItems = minItems;
  const maxItems = asCount(input.maxItems);
  if (maxItems !== undefined) schema.maxItems = maxItems;

  // `additionalProperties`, `strict` and `$schema` have no Schema equivalent and
  // are rejected rather than ignored, so they are dropped on purpose.
  return schema;
}

export function toGeminiFunctionDeclaration(tool: FunctionTool): FunctionDeclaration {
  const declaration: FunctionDeclaration = { name: tool.name };
  if (tool.description) declaration.description = tool.description;

  const parameters = toGeminiSchema(tool.parameters);
  // A parameterless function must leave `parameters` unset; an OBJECT schema with
  // no properties is not accepted everywhere.
  if (parameters?.properties) declaration.parameters = parameters;

  return declaration;
}

export function toGeminiFunctionDeclarations(
  tools: readonly FunctionTool[] = LIVE_TOOLS,
): FunctionDeclaration[] {
  return tools.map(toGeminiFunctionDeclaration);
}
