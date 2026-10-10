import type {Dataset} from '../types';

/** External research may exist in older workspaces, but is not product evidence. */
export const isInternalDataset = (dataset: Pick<Dataset,'type'>): boolean => dataset.type !== 'External research';
