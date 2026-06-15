export type SavedSceneSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  isPublished: boolean;
};

export const MAX_SAVED_SCENE_NAME_LENGTH = 120;
export const SCENE_THUMBNAIL_BLOB_PREFIX = 'scene-thumbnail';

export function getSuggestedSavedSceneName(scene?: { name: string; analysisModel?: string }) {
  const baseName = scene?.name.trim() || 'Untitled Scene';
  const model = scene?.analysisModel?.trim();

  if (!model) return baseName.slice(0, MAX_SAVED_SCENE_NAME_LENGTH);

  const displayModel = model.split(' (')[0]?.trim() || model;
  const suffix = ` - ${displayModel}`;

  if (baseName.toLowerCase().endsWith(suffix.toLowerCase())) {
    return baseName.slice(0, MAX_SAVED_SCENE_NAME_LENGTH);
  }

  const availableBaseLength = Math.max(0, MAX_SAVED_SCENE_NAME_LENGTH - suffix.length);
  return `${baseName.slice(0, availableBaseLength).trimEnd()}${suffix}`.slice(0, MAX_SAVED_SCENE_NAME_LENGTH);
}

export const normalizeSceneLookupName = (value?: string) => (
  (value || '')
    .toLowerCase()
    .replace(/\s*\(imported\)\s*$/i, '')
    .replace(/\s+-\s+gemini.*$/i, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
);

export const findMatchingSavedSceneId = (savedScenes: SavedSceneSummary[], scene?: { name?: string }, savedSceneName?: string) => {
  const lookupNames = [
    normalizeSceneLookupName(savedSceneName),
    normalizeSceneLookupName(scene?.name),
  ].filter(Boolean);

  if (lookupNames.length === 0) return undefined;

  const exactMatch = savedScenes.find(savedScene => {
    const savedName = normalizeSceneLookupName(savedScene.name);
    return lookupNames.some(name => savedName === name);
  });
  if (exactMatch) return exactMatch.id;

  const fuzzyMatches = savedScenes.filter(savedScene => {
    const savedName = normalizeSceneLookupName(savedScene.name);
    return lookupNames.some(name => savedName.includes(name) || name.includes(savedName));
  });

  return fuzzyMatches.length === 1 ? fuzzyMatches[0].id : undefined;
};
