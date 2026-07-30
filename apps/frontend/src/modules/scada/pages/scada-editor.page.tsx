'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEditor } from '../hooks/useEditor';
import { EditorToolbar } from '../components/editor/EditorToolbar';
import { WidgetPalette } from '../components/editor/WidgetPalette';
import { LayersPanel } from '../components/editor/LayersPanel';
import { EditorCanvas } from '../components/editor/EditorCanvas';
import { PropertiesPanel } from '../components/editor/PropertiesPanel';
import { ToastNotification } from '../components/editor/ToastNotification';
import { UnsavedChangesDialog } from '../components/editor/UnsavedChangesDialog';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useEditorStore } from '../store/editor.store';
import type { Widget, WidgetType } from '../types/scada.types';
import { buildDefaultWidget } from '../components/editor/widgetDefaults';
import { Loader2 } from 'lucide-react';

const CAN_EDIT_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);

interface Props { screenId: string }

export default function ScadaEditorPage({ screenId }: Props) {
  const router = useRouter();
  const user = useCurrentUser();
  const canEdit = CAN_EDIT_ROLES.has(user.role);

  useEditor(screenId);
  const { screen, addWidget, previewMode, loading, notFound, isDirty, saving, save, insertComponent, deleteComponent, components } = useEditorStore();

  // Bloqueia a saída do editor com alterações não salvas (links, reload, fechar aba).
  const { pendingHref, proceed, cancel } = useUnsavedChangesGuard(isDirty);

  async function handleSaveAndLeave() {
    await save();
    // Só sai se o save foi bem-sucedido (em erro, isDirty permanece e o toast avisa).
    if (!useEditorStore.getState().isDirty) proceed();
  }

  // Access guard — redirect non-editors to viewer
  useEffect(() => {
    if (!canEdit) {
      router.replace(`/scada-view/${screenId}`);
    }
  }, [canEdit, screenId, router]);

  function handleDropFromPalette(type: WidgetType, defaultSize: { w: number; h: number }, overrides?: Partial<Widget>) {
    if (!screen) return;
    const cx = Math.round(screen.width / 2);
    const cy = Math.round(screen.height / 2);
    const widget = buildDefaultWidget(type, cx - defaultSize.w / 2, cy - defaultSize.h / 2, defaultSize.w, defaultSize.h);
    addWidget(overrides ? ({ ...widget, ...overrides } as Widget) : widget);
  }

  if (!canEdit) return null; // redirecting

  if (loading || (!screen && !notFound)) {
    return (
      <div className="scada-dark-chrome flex h-full items-center justify-center gap-2 bg-slate-950 text-slate-400 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        Carregando tela…
      </div>
    );
  }

  if (!screen) {
    return (
      <div className="scada-dark-chrome flex h-full items-center justify-center bg-slate-950 text-slate-400 text-sm">
        Tela não encontrada — ID: {screenId}
      </div>
    );
  }

  return (
    <div className="scada-dark-chrome flex h-full flex-col overflow-hidden bg-slate-950">
      <EditorToolbar />
      <div className="flex flex-1 overflow-hidden">
        {!previewMode && (
          <div className="flex h-full w-60 shrink-0 flex-col border-r border-slate-700">
            <WidgetPalette
              onDropWidget={handleDropFromPalette}
              components={components}
              onInsertComponent={(id) => insertComponent(id)}
              onDeleteComponent={deleteComponent}
            />
            <LayersPanel />
          </div>
        )}
        <EditorCanvas />
        {!previewMode && <PropertiesPanel />}
      </div>
      <ToastNotification />
      {pendingHref && (
        <UnsavedChangesDialog
          saving={saving}
          onDiscard={proceed}
          onSaveAndLeave={handleSaveAndLeave}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
