'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const Editor2 = dynamic(() => import('./Editor2').then(mod => mod.Editor2), {
  ssr: false,
  loading: () => null,
});

export function Editor2Wrapper() {
  return <Editor2 />;
}
