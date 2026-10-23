import { useEffect, useState } from 'react';
import {
  loadEditorPreferences,
  subscribeEditorPreferences,
  type EditorPreferences,
} from './editor-preferences';

/**
 * Lee las preferencias del editor y se mantiene al día cuando cambian desde
 * Ajustes. El primer render ya trae los valores guardados (inicializador
 * perezoso), así que no hay un parpadeo con los defaults.
 */
export function useEditorPreferences(): EditorPreferences {
  const [preferences, setPreferences] = useState<EditorPreferences>(() =>
    loadEditorPreferences(),
  );

  useEffect(() => subscribeEditorPreferences(setPreferences), []);

  return preferences;
}
