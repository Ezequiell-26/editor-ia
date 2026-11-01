// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MCP_LIVE_EVENT, isMcpLiveEnabled, setMcpLiveEnabled } from './mcp-live';

describe('preferencia de control MCP en vivo', () => {
  it('arranca apagada y persiste el cambio con un evento', () => {
    window.localStorage.clear();
    expect(isMcpLiveEnabled()).toBe(false);
    const listener = vi.fn();
    window.addEventListener(MCP_LIVE_EVENT, listener);
    setMcpLiveEnabled(true);
    expect(isMcpLiveEnabled()).toBe(true);
    expect(window.localStorage.getItem('olyvia.mcp.live')).toBe('1');
    expect(listener).toHaveBeenCalledTimes(1);
    setMcpLiveEnabled(false);
    expect(isMcpLiveEnabled()).toBe(false);
    expect(window.localStorage.getItem('olyvia.mcp.live')).toBe('0');
    window.removeEventListener(MCP_LIVE_EVENT, listener);
  });
});
