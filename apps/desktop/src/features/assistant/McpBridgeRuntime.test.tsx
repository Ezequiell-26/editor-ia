// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeService } from '../../test/fake-service';
import { ProjectProvider } from '../../state/project-store';
import { McpBridgeRuntime } from './McpBridgeRuntime';

describe('McpBridgeRuntime', () => {
  it('registra el listener antes de iniciar el servidor y atiende app_status', async () => {
    const service = createFakeService();
    const order: string[] = [];
    const captured: { handler?: (payload: { id: string; tool: string; args: unknown }) => void } = {};
    const onMcpCall = vi.spyOn(service, 'onMcpCall').mockImplementation(async (callback) => {
      order.push('listener');
      captured.handler = callback;
      return () => {};
    });
    const startMcpServer = vi.spyOn(service, 'startMcpServer').mockImplementation(async () => {
      order.push('server');
      return { url: 'http://127.0.0.1:31417/mcp', token: 'stable-test-token' };
    });
    const mcpRespond = vi.spyOn(service, 'mcpRespond');

    render(<ProjectProvider service={service}><McpBridgeRuntime /></ProjectProvider>);
    await waitFor(() => expect(startMcpServer).toHaveBeenCalledOnce());
    expect(onMcpCall).toHaveBeenCalledOnce();
    expect(order).toEqual(['listener', 'server']);

    captured.handler?.({ id: 'status-1', tool: 'app_status', args: {} });
    await waitFor(() => expect(mcpRespond).toHaveBeenCalledOnce());
    const response = mcpRespond.mock.calls[0]!;
    const [id, ok, text] = response;
    expect(id).toBe('status-1');
    expect(ok).toBe(true);
    expect(JSON.parse(text)).toEqual({ app: 'olyvia', project: null, open: false });
  });
});
