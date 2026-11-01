/**
 * Puente tipado con los comandos Rust de la biblioteca de motions.
 * El backend valida URL, id, tamaño y SHA-256 antes de escribir en disco.
 */
import { invoke } from '@tauri-apps/api/core';

export interface CachedMotion {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly modifiedMs: number;
}

export interface MotionCacheStats {
  readonly dir: string;
  readonly count: number;
  readonly bytes: number;
}

export interface MotionDownloadRequest {
  readonly id: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
}

export function motionCacheDir(): Promise<string> {
  return invoke<string>('motion_cache_dir');
}

export function motionListCached(): Promise<CachedMotion[]> {
  return invoke<CachedMotion[]>('motion_list_cached');
}

export function motionCacheStats(): Promise<MotionCacheStats> {
  return invoke<MotionCacheStats>('motion_cache_stats');
}

export function motionDownload(request: MotionDownloadRequest): Promise<CachedMotion> {
  return invoke<CachedMotion>('motion_download', { ...request });
}

export function motionReadCached(id: string, sha256: string): Promise<string> {
  return invoke<string>('motion_read_cached', { id, sha256 });
}

export function motionRemoveCached(id: string): Promise<boolean> {
  return invoke<boolean>('motion_remove_cached', { id });
}
