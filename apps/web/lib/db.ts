import { get, set, del, keys } from 'idb-keyval';

export const saveBlob = async (id: string, blob: Blob) => {
  await set(`clip-media-${id}`, blob);
};

export const loadBlob = async (id: string): Promise<Blob | undefined> => {
  return await get(`clip-media-${id}`);
};

export const deleteBlob = async (id: string) => {
  await del(`clip-media-${id}`);
};

export const clearOldBlobs = async (activeIds: string[]) => {
  const allKeys = await keys();
  const mediaKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith('clip-media-'));
  for (const key of mediaKeys) {
    const id = (key as string).replace('clip-media-', '');
    if (!activeIds.includes(id)) {
      await del(key);
    }
  }
};
