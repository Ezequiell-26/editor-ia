import { z } from 'zod';

/**
 * A project-relative asset path.
 *
 * Serialized projects are portable JSON, so paths always use forward slashes
 * and are resolved against the project root by the Rust boundary. A stored
 * path must never be able to escape that root or name a shell target.
 */

export const PROJECT_RELATIVE_PATH_MAX_LENGTH = 512;

/** Characters Windows or POSIX shells treat specially in a file name. The
 * forward slash is the only allowed separator, so it is not listed here. */
const FORBIDDEN_CHARACTERS = /[<>:"|?*\\]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f]/;
const DRIVE_PREFIX = /^[A-Za-z]:/;

export const ProjectRelativePathSchema = z
  .string()
  .min(1, 'a project path must not be empty')
  .max(PROJECT_RELATIVE_PATH_MAX_LENGTH, 'a project path is unrealistically long')
  .refine((value) => !value.startsWith('/'), 'a project path must not be absolute')
  .refine((value) => !value.startsWith('~'), 'a project path must not reference a home directory')
  .refine((value) => !DRIVE_PREFIX.test(value), 'a project path must not contain a drive letter')
  .refine((value) => !value.endsWith('/'), 'a project path must not end with a separator')
  .refine(
    (value) => !CONTROL_CHARACTERS.test(value),
    'a project path must not contain control characters',
  )
  .refine(
    (value) => !FORBIDDEN_CHARACTERS.test(value),
    'a project path must use forward slashes and avoid reserved characters',
  )
  .refine(
    (value) => value.split('/').every((segment) => segment.length > 0),
    'a project path must not contain empty segments',
  )
  .refine(
    (value) => !value.split('/').includes('..'),
    'a project path must not escape the project root',
  );

export type ProjectRelativePath = z.infer<typeof ProjectRelativePathSchema>;
