import assert from "node:assert/strict";
import test from "node:test";

import { Type } from "@google/genai";

import { toGeminiFunctionDeclaration, toGeminiFunctionDeclarations, toGeminiSchema } from "../src/live/gemini-tools.js";
import { LIVE_TOOLS } from "../src/live/tools.js";

// Tool definitions are authored once in OpenAI's shape. If the translation to
// Gemini's OpenAPI-flavoured Schema drops a tool or emits a field Gemini rejects,
// the model silently loses that capability mid-call, so the contract is pinned here.

const VALID_TYPES = new Set(Object.values(Type));
const ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "enum",
  "format",
  "properties",
  "required",
  "items",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
]);

function assertSchemaValid(schema: unknown, path: string): void {
  assert.ok(schema && typeof schema === "object", `${path} must be an object`);
  const record = schema as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    assert.ok(ALLOWED_SCHEMA_KEYS.has(key), `${path} must not carry "${key}"`);
  }
  if (record.type !== undefined) {
    assert.ok(VALID_TYPES.has(record.type as Type), `${path}.type ${String(record.type)} is not a Type`);
  }
  if (record.minItems !== undefined) {
    assert.equal(typeof record.minItems, "string", `${path}.minItems must be a string`);
  }
  if (record.maxItems !== undefined) {
    assert.equal(typeof record.maxItems, "string", `${path}.maxItems must be a string`);
  }
  if (record.properties !== undefined) {
    for (const [name, value] of Object.entries(record.properties as Record<string, unknown>)) {
      assertSchemaValid(value, `${path}.properties.${name}`);
    }
  }
  if (record.items !== undefined) assertSchemaValid(record.items, `${path}.items`);
  if (record.required !== undefined) {
    assert.ok(Array.isArray(record.required), `${path}.required must be an array`);
    const properties = (record.properties ?? {}) as Record<string, unknown>;
    for (const name of record.required as string[]) {
      assert.ok(name in properties, `${path}.required names "${name}" which is not a property`);
    }
  }
}

test("every live tool converts to a function declaration", () => {
  const declarations = toGeminiFunctionDeclarations();
  assert.equal(declarations.length, LIVE_TOOLS.length);
  assert.deepEqual(
    declarations.map((declaration) => declaration.name),
    LIVE_TOOLS.map((tool) => tool.name),
  );
  for (const declaration of declarations) {
    assert.ok(declaration.name, "a declaration without a name cannot be called");
    assert.ok(declaration.description, `${declaration.name} must keep its description`);
  }
});

test("converted parameter schemas are valid Gemini schemas", () => {
  for (const declaration of toGeminiFunctionDeclarations()) {
    if (declaration.parameters === undefined) continue;
    assertSchemaValid(declaration.parameters, `${declaration.name}.parameters`);
    assert.equal(declaration.parameters.type, Type.OBJECT);
  }
});

test("JSON Schema types become Type enum members and additionalProperties is dropped", () => {
  const schema = toGeminiSchema({
    type: "object",
    properties: {
      name: { type: "string", description: "a name" },
      count: { type: "integer", minimum: 1, maximum: 25 },
      ratio: { type: "number" },
      flag: { type: "boolean" },
      tags: { type: "array", items: { type: "string" }, maxItems: 2 },
    },
    required: ["name"],
    additionalProperties: false,
  });

  assert.ok(schema);
  assert.equal(schema.type, Type.OBJECT);
  assert.ok(!("additionalProperties" in schema));
  assert.equal(schema.properties?.name?.type, Type.STRING);
  assert.equal(schema.properties?.name?.description, "a name");
  assert.equal(schema.properties?.count?.type, Type.INTEGER);
  assert.equal(schema.properties?.count?.minimum, 1);
  assert.equal(schema.properties?.count?.maximum, 25);
  assert.equal(schema.properties?.ratio?.type, Type.NUMBER);
  assert.equal(schema.properties?.flag?.type, Type.BOOLEAN);
  assert.equal(schema.properties?.tags?.type, Type.ARRAY);
  assert.equal(schema.properties?.tags?.items?.type, Type.STRING);
  assert.equal(schema.properties?.tags?.maxItems, "2", "item counts are int64 strings, not numbers");
  assert.deepEqual(schema.required, ["name"]);
});

test("a parameterless tool leaves parameters unset", () => {
  const declaration = toGeminiFunctionDeclaration({
    type: "function",
    name: "get_screen_context",
    description: "desc",
    strict: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  });
  assert.equal(declaration.parameters, undefined);
});

test("nested object properties convert recursively (present_choices)", () => {
  const presentChoices = toGeminiFunctionDeclarations().find(
    (declaration) => declaration.name === "present_choices",
  );
  assert.ok(presentChoices, "present_choices must survive the conversion");

  const primary = presentChoices.parameters?.properties?.primary;
  assert.equal(primary?.type, Type.OBJECT);
  assert.equal(primary?.properties?.business_id?.type, Type.STRING);
  assert.deepEqual(primary?.required, ["business_id", "reason"]);

  const backups = presentChoices.parameters?.properties?.backups;
  assert.equal(backups?.type, Type.ARRAY);
  assert.equal(backups?.items?.type, Type.OBJECT);
  assert.equal(backups?.maxItems, "2");
});

test("top_businesses is exposed to Gemini", () => {
  const declaration = toGeminiFunctionDeclarations().find(
    (item) => item.name === "top_businesses",
  );
  assert.ok(declaration, "the leaderboard tool must reach the model");
  assert.equal(declaration.parameters?.properties?.businessType?.type, Type.STRING);
  assert.equal(declaration.parameters?.properties?.limit?.maximum, 25);
});
