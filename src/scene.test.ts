import { describe, expect, it } from 'vitest';
import { defaultScene, LIGHT_COLORS, resetScene } from './scene';

describe('resetScene', () => {
  it('restores every default in place, keeping object identity', () => {
    const s = defaultScene();
    const objects = s.objects;
    const first = s.objects[0];
    const light = s.light;
    s.bounces = 8;
    s.objects[0].mat = 4;
    s.objects[2].pos = [0, 0, 0];
    s.light.x = 0.5;
    s.light.half = 0.4;
    s.light.color = [...LIGHT_COLORS[3].rgb];
    s.camera.yaw = 0.4;
    s.camera.pitch = -0.1;

    resetScene(s);

    expect(s).toEqual(defaultScene());
    expect(s.objects).toBe(objects);
    expect(s.objects[0]).toBe(first);
    expect(s.light).toBe(light);
  });
});
