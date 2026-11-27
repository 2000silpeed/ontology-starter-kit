// Minimal agent runtime: mounts the ontology tools as an in-process MCP server
// and runs one prompt through the Claude Agent SDK.
//
// Usage: npm run agent -- "DEL-0002 출하일을 12월 1일로 미뤄도 될까? 근거를 보여줘"
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { buildOntologyTools } from './ontologyTools.ts';

const prompt = process.argv.slice(2).join(' ').trim();
if (!prompt) {
  console.error('Usage: npm run agent -- "<prompt>"');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

const { server, toolNames } = await buildOntologyTools();
console.error(`[ontology-starter-kit] tools: ${toolNames.join(', ')}`);

const stream = query({
  prompt,
  options: {
    mcpServers: { ontology: server },
    allowedTools: toolNames.map((name) => `mcp__ontology__${name}`),
    maxTurns: 12,
  },
});

for await (const message of stream) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') {
        console.log(block.text);
      } else if (block.type === 'tool_use') {
        console.error(`[tool] ${block.name}`);
      }
    }
  } else if (message.type === 'result') {
    const r = message as { subtype?: string; is_error?: boolean; num_turns?: number };
    console.error(`\n[result] subtype=${r.subtype} turns=${r.num_turns} error=${r.is_error ?? false}`);
  }
}
