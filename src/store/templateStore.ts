import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { idbStorage, idbBlobPut, idbBlobGet, idbBlobDelete } from './idbStorage';
import { PARSER_VERSION, parseImsccTemplate } from '../services/template/parser';
import type { Template } from '../types/template';

function blobKey(templateId: string): string {
  return `template:${templateId}:imscc`;
}

interface TemplateState {
  templates: Template[];
  /** Currently selected template id, surfaced by Setup once we wire it up. */
  activeTemplateId: string | null;

  addTemplate: (template: Template, blob: Blob) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
  setActiveTemplate: (id: string | null) => void;
  /** Read the raw .imscc Blob for a template id, for export-time re-use. */
  getTemplateBlob: (id: string) => Promise<Blob | null>;
}

async function reparseStaleTemplates(initialTemplates: Template[]): Promise<void> {
  const stale = initialTemplates.filter((t) => (t.parserVersion ?? 0) < PARSER_VERSION);
  if (stale.length === 0) return;

  for (const t of stale) {
    const blob = await idbBlobGet(blobKey(t.id));
    if (!blob) continue;
    try {
      const reparsed = await parseImsccTemplate({ file: blob, name: t.name });
      // Preserve the original id and uploadedAt so the user's selection
      // doesn't drift on re-parse.
      const updated: Template = { ...reparsed, id: t.id, uploadedAt: t.uploadedAt };
      useTemplateStore.setState((s) => ({
        templates: s.templates.map((x) => (x.id === t.id ? updated : x)),
      }));
    } catch (err) {
       
      console.warn(`Failed to re-parse stale template ${t.id}:`, err);
    }
  }
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set) => ({
      templates: [],
      activeTemplateId: null,

      addTemplate: async (template, blob) => {
        await idbBlobPut(blobKey(template.id), blob);
        set((state) => ({
          templates: [...state.templates.filter((t) => t.id !== template.id), template],
          activeTemplateId: template.id,
        }));
      },

      removeTemplate: async (id) => {
        await idbBlobDelete(blobKey(id));
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
          activeTemplateId: state.activeTemplateId === id ? null : state.activeTemplateId,
        }));
      },

      setActiveTemplate: (id) => set({ activeTemplateId: id }),

      getTemplateBlob: (id) => idbBlobGet(blobKey(id)),
    }),
    {
      name: 'classbuild-templates',
      storage: idbStorage,
      partialize: (state) => ({
        templates: state.templates,
        activeTemplateId: state.activeTemplateId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state || state.templates.length === 0) return;
        // Fire-and-forget — re-parse runs in the background and updates the
        // store as each template completes.
        void reparseStaleTemplates(state.templates);
      },
    },
  ),
);
