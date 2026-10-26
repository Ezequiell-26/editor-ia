// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import { PreviewTransformBox } from './PreviewTransformBox';
import { clipTransformAtFrame } from '../../state/project-actions';
import { movePatch } from './transform-overlay';

let project: ProjectDocument;
const calls: string[] = [];
vi.mock('../../state/project-store', () => ({
  useProjectStore: () => ({
    update: (recipe: (current: ProjectDocument) => ProjectDocument) => {
      calls.push('update');
      project = recipe(project);
    },
  }),
}));

describe('debug', () => {
  afterEach(() => cleanup());
  it('log drag', () => {
    const asset = readyAsset();
    project = ensureDelivery(createEmptyProject('Prueba'));
    project = addClipFromAsset(addAsset(project, asset), asset, {}).project;
    const clip = project.timeline.clips[0]!;
    console.log('clip kind', clip.kind, 'id', clip.id);
    console.log('sample', JSON.stringify(clipTransformAtFrame(clip, 0)));
    console.log('movePatch', JSON.stringify(movePatch({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 }, { x: 50, y: 30 }, project.video, { width: 960, height: 540 })));
    const { getByTestId } = render(
      <div className="preview-canvas">
        <PreviewTransformBox clip={clip} project={project} playheadFrame={0} canvas={{ width: 960, height: 540 }} />
      </div>,
    );
    const box = getByTestId('transform-box');
    console.log('box found', Boolean(box));
    fireEvent.pointerDown(box, { clientX: 480, clientY: 270, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 530, clientY: 300 });
    fireEvent.pointerUp(box);
    console.log('calls', calls.length, 'transform', JSON.stringify(project.timeline.clips[0]!.transform));
    expect(calls.length).toBeGreaterThan(0);
  });
});
