import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { createBaseExtensions } from './base-extensions.js';

let cachedSchema: Schema | null = null;

export function collabySchema(): Schema {
  if (!cachedSchema) {
    cachedSchema = getSchema(createBaseExtensions({ history: false, placeholder: undefined }));
  }
  return cachedSchema;
}
