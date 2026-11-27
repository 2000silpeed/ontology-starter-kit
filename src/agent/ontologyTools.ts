import { z } from 'zod';
import { tool, createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const HONO_URL = process.env.HONO_URL ?? 'http://localhost:3456';
const CALLER_ID = process.env.AGENT_CALLER_ID ?? 'ops-agent';

type AnyTool = SdkMcpToolDefinition<any>;

function textResult(data: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError };
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${HONO_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-caller-identity': CALLER_ID,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── fixed read tool handlers ────────────────────────────────────────────────
async function queryObjectsHandler(args: { type: string; filters?: unknown; limit?: number }) {
  try {
    const data = await api('POST', `/objects/${encodeURIComponent(args.type)}/query`, {
      filters: args.filters ?? [],
      limit: args.limit,
    });
    return textResult(data);
  } catch (err) {
    return textResult({ error: String(err) }, true);
  }
}

async function getObjectHandler(args: { type: string; id: string }) {
  try {
    const data = await api('GET', `/objects/${encodeURIComponent(args.type)}/${encodeURIComponent(args.id)}`);
    return textResult(data);
  } catch (err) {
    return textResult({ error: String(err) }, true);
  }
}

const queryObjectsTool = tool(
  'query_objects',
  'Query instances of an object type with optional filters. Filters are ANDed together. Returns matching rows as JSON.',
  {
    type: z.string().describe('Object type api_name, e.g. "delivery"'),
    filters: z
      .array(
        z.object({
          property: z.string().describe('Property api_name to filter on'),
          op: z
            .enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'isNull', 'isNotNull'])
            .describe('Comparison operator'),
          value: z.unknown().optional().describe('Value to compare against; array for "in", omitted for isNull/isNotNull'),
        }),
      )
      .optional()
      .describe('Filters to apply'),
    limit: z.number().optional().describe('Max rows to return (default 50)'),
  },
  queryObjectsHandler,
);

const getObjectTool = tool(
  'get_object',
  'Get one instance by id, including its linked objects (e.g. the customer of a sales order).',
  {
    type: z.string().describe('Object type api_name'),
    id: z.string().describe('Domain id of the instance, e.g. "DEL-0001"'),
  },
  getObjectHandler,
);

const READ_TOOLS: any[] = [queryObjectsTool, getObjectTool];

// ── dynamic action tools from action_type metadata ──────────────────────────
// Supports the JSON Schema subset the kit uses: type string|number|boolean,
// description, required, additionalProperties.
function zodShapeFromParameterSchema(schema: unknown): Record<string, any> {
  const shape: Record<string, any> = {};
  const s = (schema ?? {}) as {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  const required: string[] = Array.isArray(s.required) ? s.required : [];
  for (const [key, prop] of Object.entries(s.properties ?? {})) {
    let t: z.ZodTypeAny;
    switch (prop.type) {
      case 'number':
        t = z.number();
        break;
      case 'boolean':
        t = z.boolean();
        break;
      default:
        t = z.string();
    }
    if (prop.description) t = t.describe(prop.description);
    shape[key] = required.includes(key) ? t : t.optional();
  }
  return shape;
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

interface ActionTypeInfo {
  api_name: string;
  name: string;
  description: string;
  object_type: string;
  parameter_schema: unknown;
}

export async function buildOntologyTools(): Promise<{
  server: ReturnType<typeof createSdkMcpServer>;
  toolNames: string[];
}> {
  const res = await fetch(`${HONO_URL}/meta/actions`);
  const data = (await res.json()) as { actions: ActionTypeInfo[] };

  const tools: any[] = [...READ_TOOLS];

  for (const action of data.actions) {
    const toolName = `${snakeCase(action.object_type)}_${snakeCase(action.api_name)}`;
    const shape = zodShapeFromParameterSchema(action.parameter_schema);
    const targetShape: Record<string, z.ZodTypeAny> = {
      targetId: z.string().describe(`Domain id of the ${action.object_type} to act on`),
      ...shape,
    };

    const handler = async (args: Record<string, unknown>) => {
      const { targetId, ...params } = args;
      try {
        const data = (await api(
          'POST',
          `/actions/${encodeURIComponent(action.object_type)}/${encodeURIComponent(String(targetId))}/${encodeURIComponent(action.api_name)}`,
          params,
        )) as Record<string, unknown>;
        return textResult({ ok: true, ...data });
      } catch (err) {
        return textResult({ error: String(err) }, true);
      }
    };

    tools.push(tool(toolName, action.description, targetShape, handler));
  }

  const server = createSdkMcpServer({ name: 'ontology', tools: tools as never });
  const toolNames = tools.map((t) => (t as unknown as { name: string }).name);
  return { server, toolNames };
}
