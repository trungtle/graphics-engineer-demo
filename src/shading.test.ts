import { describe, expect, it } from 'vitest';
import { ERAS, GI, includes } from './shading';

describe('era presets', () => {
  it('has five steps from 1993 to today, ending on global illumination', () => {
    expect(ERAS.map((e) => e.year)).toEqual(['1993', '1997', '2004', '2012', 'Today']);
    expect(ERAS[ERAS.length - 1].shading).toBe(GI);
    expect(ERAS[0].shading.mode).toBe('features');
  });

  it('each step only adds features to the one before it', () => {
    for (let i = 1; i < ERAS.length; i++) {
      expect(includes(ERAS[i].shading, ERAS[i - 1].shading)).toBe(true);
    }
  });

  it('no step is identical to the previous one', () => {
    for (let i = 1; i < ERAS.length; i++) {
      expect(JSON.stringify(ERAS[i].shading)).not.toBe(JSON.stringify(ERAS[i - 1].shading));
    }
  });
});
