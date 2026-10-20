import { describe, expect, it } from 'vitest';
import { friendlyAssetLabel } from './asset-labels';

describe('friendlyAssetLabel', () => {
  it('keeps human names intact', () => {
    expect(friendlyAssetLabel('Card verde.png')).toBe('Card verde');
  });

  it('shortens generated narration names and keeps a unique suffix', () => {
    expect(
      friendlyAssetLabel('narracion-45ec0707-1fef-496f-97b2-079fe70f89d4.wav'),
    ).toBe('Narración · 45ec');
  });

  it('keeps other generated stems readable', () => {
    expect(friendlyAssetLabel('escena_02-abcdef12-0000-4000-8000-123456789abc.mp4')).toBe(
      'Escena 02 · abcd',
    );
  });
});
