import { useEffect } from 'react';
import { useEditorStore } from '../store/editor.store';

export function useEditor(screenId: string) {
  const store = useEditorStore();

  useEffect(() => {
    store.loadScreen(screenId);
  }, [screenId]); // eslint-disable-line react-hooks/exhaustive-deps

  return store;
}
