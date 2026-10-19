import { describe, expect, it } from 'vitest';
import { ProjectRelativePathSchema } from './paths.ts';

const rejected = (value: string) => {
  it(`rejects ${JSON.stringify(value)}`, () => {
    expect(ProjectRelativePathSchema.safeParse(value).success).toBe(false);
  });
};

describe('ProjectRelativePathSchema', () => {
  it('accepts a project-relative posix path', () => {
    expect(ProjectRelativePathSchema.safeParse('media/clip-01.mp4').success).toBe(true);
  });

  it('accepts nested directories and unicode file names', () => {
    expect(ProjectRelativePathSchema.safeParse('recursos/escena 01/título.webm').success).toBe(true);
  });

  it('accepts a single file name without a directory', () => {
    expect(ProjectRelativePathSchema.safeParse('intro.mp4').success).toBe(true);
  });

  rejected('');
  rejected('../escape.mp4');
  rejected('media/../../escape.mp4');
  rejected('media/../escape.mp4');
  rejected('/etc/passwd');
  rejected('//server/share/clip.mp4');
  rejected('~/secrets/clip.mp4');
  rejected('C:\\media\\clip.mp4');
  rejected('C:/media/clip.mp4');
  rejected('media\\clip.mp4');
  rejected('media/');
  rejected('media/clip|pipe.mp4');
  rejected('media/clip<?.mp4');
  rejected('media/clip\x00.mp4');
});
