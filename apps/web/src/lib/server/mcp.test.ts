import { describe, expect, it } from 'vitest';
import type { AgentContext } from './agent';
import { htmlToText } from './agent';
import { handleMcp, SUPPORTED_VERSIONS, TOOLS } from './mcp';

// No database: these cases never reach one (protocol methods, or a scope check first).
const ctx = (scopes: string) =>
	({
		db: null,
		user: { id: 'u' },
		token: { id: 't', name: 'test', scopes },
		origin: 'https://r.test'
	}) as unknown as AgentContext;

// id null = a notification (no id at all).
const call = (method: string, params?: object, id: number | null = 1) =>
	handleMcp(ctx('links:read'), { jsonrpc: '2.0', method, params, ...(id !== null && { id }) });

describe('handleMcp', () => {
	it('initializes, echoing a supported protocol version', async () => {
		const res = (await call('initialize', { protocolVersion: '2025-06-18' })) as {
			result: Record<string, unknown>;
		};
		expect(res.result.protocolVersion).toBe('2025-06-18');
		expect(res.result.capabilities).toEqual({ tools: { listChanged: false } });
		const other = (await call('initialize', { protocolVersion: '1999-01-01' })) as {
			result: { protocolVersion: string };
		};
		expect(other.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
	});

	it('lists every tool with a schema and annotations', async () => {
		const res = (await call('tools/list')) as {
			result: { tools: { name: string; inputSchema: object; annotations: object }[] };
		};
		expect(res.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
		for (const t of res.result.tools) {
			expect(t.inputSchema).toMatchObject({ type: 'object' });
			expect(t.annotations).toHaveProperty('readOnlyHint');
		}
	});

	it('answers ping, returns null for notifications, and rejects unknown methods and bad messages', async () => {
		expect(await call('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
		expect(await call('notifications/initialized', undefined, null)).toBeNull();
		expect(await call('resources/list')).toMatchObject({ error: { code: -32601 } });
		expect(await handleMcp(ctx(''), [{ jsonrpc: '2.0', id: 1, method: 'ping' }])).toMatchObject({
			error: { code: -32600 }
		});
		expect(await handleMcp(ctx(''), { id: 1, method: 'ping' })).toMatchObject({
			error: { code: -32600 }
		});
	});

	it('reports a missing scope as a tool error the model can read', async () => {
		const res = (await handleMcp(ctx('links:read'), {
			jsonrpc: '2.0',
			id: 7,
			method: 'tools/call',
			params: { name: 'save_link', arguments: { url: 'https://x.test' } }
		})) as { result: { isError: boolean; content: { text: string }[] } };
		expect(res.result.isError).toBe(true);
		expect(res.result.content[0].text).toContain('links:write');
	});

	it('needs feeds:write to follow a feed', async () => {
		const res = (await handleMcp(ctx('feeds:read links:write'), {
			jsonrpc: '2.0',
			id: 8,
			method: 'tools/call',
			params: { name: 'add_feed', arguments: { url: 'https://blog.test' } }
		})) as { result: { isError: boolean; content: { text: string }[] } };
		expect(res.result.isError).toBe(true);
		expect(res.result.content[0].text).toContain('feeds:write');
	});

	it('rejects unknown tools', async () => {
		expect(await call('tools/call', { name: 'rm_rf' })).toMatchObject({ error: { code: -32602 } });
	});
});

describe('htmlToText', () => {
	it('keeps paragraphs and list items and drops markup and scripts', () => {
		expect(
			htmlToText(
				'<h2>Title</h2><p>One &amp; <b>two</b>.</p><ul><li>a</li><li>b</li></ul><script>x()</script><p>End<br>line</p>'
			)
		).toBe('Title\n\nOne & two.\n\n• a\n\n• b\n\nEnd\nline');
	});
});
