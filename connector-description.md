# Connector descriptions

Reusable copy for submission forms (Claude Connectors directory, ChatGPT App Directory, MCP Registry).

## Short tagline (max 60 chars)

Czech expert restaurant recommendations

## One-liner (max 140 chars)

Expert-curated tips on Czech restaurants, cafés, and bars — searchable by location and expert. Same data as the Futrumi iOS app.

## Long description (~250 words)

**Futrumi** is a Czech food-tip platform: named food critics, chefs, sommeliers, and gastronomy
journalists share where they actually like to eat and drink, with the exact dish or drink they
recommend. The Futrumi MCP server exposes that curated, published data to AI assistants so users
can ask things like *"najdi mi vínárnu v Karlíně"* or *"co doporučuje Michal Daněk"* and get
real expert opinions, not generic web results.

Each result includes the expert's name, their quote in the original Czech, the specific business,
and a deep link to open the business in the Futrumi mobile app. Recommendations cover restaurants,
cafés, bars, bakeries, wine shops, and other food businesses, primarily in Prague and Brno but
expanding to other Czech cities.

The connector exposes six read-only tools:

- `search_recommendations` — find expert tips around a place by category or vibe
- `find_recommendations_near` — list expert-recommended businesses near a coordinate or address
- `get_recommendation` — full text of a single expert recommendation with the strong quote and meals
- `get_business` — full business profile with all expert recommendations about it
- `get_expert` — an expert's bio and the businesses they've recommended
- `list_experts` — directory of all Futrumi experts

All data served is the same data already published in the Futrumi iOS app — no private, draft,
or pre-publication content is exposed. The connector is anonymous (no account, no API key)
and read-only.

## Categories / tags

Lifestyle · Food & Drink · Travel · Czech Republic · Restaurant recommendations
