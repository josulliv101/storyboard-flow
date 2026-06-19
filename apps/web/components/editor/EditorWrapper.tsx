'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./Editor').then(mod => mod.Editor), {
  ssr: false,
  loading: () => null,
});

export function EditorWrapper() {
  return <Editor />;
}
