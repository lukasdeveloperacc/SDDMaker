import { expect, it } from 'vitest';
import { cleanOptions } from '@/lib/agent-options';

it('모델·강도는 허용된 형식만 통과시킨다', () => {
  expect(cleanOptions({ model: 'opus', effort: 'high' })).toEqual({ model: 'opus', effort: 'high' });
  expect(cleanOptions({ model: '--evil x', effort: 'turbo' })).toEqual({ model: undefined, effort: undefined });
  expect(cleanOptions({ model: 'claude-opus-4[1m]' }).model).toBe('claude-opus-4[1m]');
});
