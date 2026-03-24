export interface ModelResponse {
  toolCalls: { name: string; input: Record<string, unknown>; id?: string }[];
  textContent: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type Message = { role: 'user' | 'assistant'; content: unknown };

export interface ModelAdapter {
  call(
    systemPrompt: string,
    messages: Message[],
    tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  ): Promise<ModelResponse>;
}

export class ClaudeAdapter implements ModelAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-haiku-4-5-20251001') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async call(
    systemPrompt: string,
    messages: Message[],
    tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  ): Promise<ModelResponse> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages as Parameters<typeof client.messages.create>[0]['messages'],
    };
    if (tools.length > 0) {
      params.tools = tools;
      params.tool_choice = { type: 'any' };
    }
    const response = await client.messages.create(params as Parameters<typeof client.messages.create>[0]);

    const toolCalls: { name: string; input: Record<string, unknown>; id?: string }[] = [];
    let textContent: string | null = null;

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, input: block.input as Record<string, unknown>, id: block.id });
      } else if (block.type === 'text') {
        textContent = block.text;
      }
    }

    return {
      toolCalls,
      textContent,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

export class OpenAIAdapter implements ModelAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-5.4-nano') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async call(
    systemPrompt: string,
    messages: Message[],
    tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  ): Promise<ModelResponse> {
    // Convert Anthropic-style messages to OpenAI format
    const openaiMessages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          openaiMessages.push({ role: 'user', content: msg.content });
        } else if (Array.isArray(msg.content)) {
          // Tool results from multi-turn
          for (const block of msg.content as { type: string; tool_use_id: string; content: string }[]) {
            if (block.type === 'tool_result') {
              openaiMessages.push({
                role: 'tool',
                content: block.content,
                tool_call_id: block.tool_use_id,
              } as any);
            }
          }
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          // Tool use blocks from multi-turn
          const toolCalls = (msg.content as { type: string; id: string; name: string; input: unknown }[])
            .filter(b => b.type === 'tool_use')
            .map(b => ({
              id: b.id,
              type: 'function',
              function: { name: b.name, arguments: JSON.stringify(b.input) },
            }));
          openaiMessages.push({ role: 'assistant', tool_calls: toolCalls } as any);
        }
      }
    }

    // Convert tool definitions to OpenAI format
    const openaiTools = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: openaiMessages,
        tools: openaiTools,
        tool_choice: 'required',
        max_completion_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: { message: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0]?.message;
    const toolCalls: { name: string; input: Record<string, unknown>; id?: string }[] = [];
    let textContent: string | null = choice?.content ?? null;

    if (choice?.tool_calls) {
      for (const tc of choice.tool_calls) {
        try {
          toolCalls.push({
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
            id: tc.id,
          });
        } catch {}
      }
    }

    return {
      toolCalls,
      textContent,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}

/**
 * Creates the right adapter based on model string.
 * Models starting with "gpt-" use OpenAI, others use Claude.
 */
export function createAdapter(model: string): ModelAdapter {
  if (model.startsWith('gpt-')) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI models');
    return new OpenAIAdapter(apiKey, model);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for Claude models');
  return new ClaudeAdapter(apiKey, model);
}
