import {z} from 'zod';
import type {Workspace} from '../types';
import {dimensions} from '../types';
import {priorityFor, scoreRequirement} from './scoring';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const text = z.string();
const id = z.string().refine(value => !!value.trim(), 'Must not be empty');
const date = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid timestamp');
const positiveInt = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const nonnegativeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const confidence = z.number().min(0).max(100);
const priority = z.enum(['P1','P2','P3']);
const status = z.enum(['Draft','Proposed','Awaiting review','More evidence requested','Challenged','Approved','Rejected','Deferred','Superseded']);
const rating = z.number().min(1).max(5).nullable();
const scores = z.strictObject({impact:rating, frequency:rating, strategy:rating, evidence:rating, feasibility:rating});
const weight = z.number().min(0).max(100);
const weights = z.strictObject({impact:weight, frequency:weight, strategy:weight, evidence:weight, feasibility:weight})
  .refine(value => Math.abs(dimensions.reduce((sum, key) => sum + value[key], 0) - 100) <= 0.01, 'Weights must total 100%');
const thresholds = z.strictObject({p1:z.number().max(100),p2:z.number().gt(0)})
  .refine(value => value.p1 > value.p2, 'Thresholds must satisfy 0 < P2 < P1 <= 100');
const ids = z.array(id).refine(values => new Set(values).size === values.length, 'Duplicate references');
const projectSchema = z.strictObject({id, name:id, derivative:id, market:id, horizon:text});
const sourceSchema = z.strictObject({id, datasetId:id, content:text, fields:z.record(z.string(), z.json()), row:positiveInt, sheet:text.optional(), category:text.optional()});
const datasetSchema = z.strictObject({id, projectId:id, name:id, type:z.enum(['Customer verbatims','Equipment list','Sales volumes','Customer study','External research']), synthetic:z.boolean(), status:z.enum(['Ready','Needs mapping','Validation errors']), createdAt:date, records:z.array(sourceSchema), errors:z.array(text), columns:z.array(text)});
const findingSchema = z.strictObject({id, projectId:id, title:id, description:text, need:text, type:text, category:text, sources:ids, contradictions:ids, confidence, strength:z.enum(['Strong','Moderate','Weak']), implication:text, status:z.enum(['New','Validated','Challenged','Excluded']), createdAt:date, synthetic:z.boolean(), rationale:text.optional(), runId:id.optional()});
const versionSchema = z.strictObject({version:positiveInt, title:id, statement:text, status, scores, at:date, reason:text, priorityOverride:priority.optional(), modelVersion:positiveInt, weights, thresholds, category:text.optional(), assumptions:text.optional(), uncertainty:text.optional(), confidence:confidence.optional(), findings:ids.optional()});
const requirementSchema = z.strictObject({id, projectId:id, title:id, statement:text, category:text, findings:ids, scores, status, assumptions:text, uncertainty:text, rationale:text, confidence, createdAt:date, updatedAt:date, createdBy:text, version:positiveInt, history:z.array(versionSchema), priorityOverride:priority.optional(), overrideReason:text.optional(), synthetic:z.boolean()});
const auditSchema = z.strictObject({id, projectId:id, at:date, actor:z.enum(['PM','AI','System']), actorId:text, action:text, entityType:id, entityId:id, before:z.json(), after:z.json(), rationale:text, relatedIds:ids, version:positiveInt.optional(), runId:id.optional()});
const modelSchema = z.strictObject({version:positiveInt, weights, thresholds, updatedAt:date});
const requestSchema = z.strictObject({id, projectId:id, requirementId:id, text, status:z.enum(['Open','Resolved']), createdAt:date});
const metricsSchema = z.strictObject({seconds:z.number().min(0), api_calls:nonnegativeInt, input_tokens:nonnegativeInt, output_tokens:nonnegativeInt, reasoning_tokens:nonnegativeInt, model:text});
const runSchema = z.strictObject({id, projectId:id, datasets:ids, at:date, mode:z.enum(['Demo','AI']), findingIds:ids, requirementIds:ids, metrics:metricsSchema.optional()});
const workspaceSchema = z.strictObject({schemaVersion:z.literal(1), revision:nonnegativeInt, projects:z.array(projectSchema).min(1), datasets:z.array(datasetSchema), findings:z.array(findingSchema), requirements:z.array(requirementSchema), audit:z.array(auditSchema), model:modelSchema, requests:z.array(requestSchema), runs:z.array(runSchema)});

/** Validate all imported state before changing browser storage. */
export function validateWorkspaceBackup(input:unknown):Workspace {
  const result = workspaceSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid workspace backup at ${issue.path.join('.') || 'workspace'}: ${issue.message}.`);
  }
  const state = result.data as Workspace;
  const projects = new Set(state.projects.map(project => project.id));
  const known = new Map<string,{projectId:string; kind:string}>();
  const register = (item:{id:string}, projectId:string, kind:string) => {
    if (known.has(item.id)) throw new Error(`Invalid workspace backup: duplicate ID ${item.id}.`);
    if (!projects.has(projectId)) throw new Error(`Invalid workspace backup: ${item.id} references unknown project ${projectId}.`);
    known.set(item.id, {projectId,kind});
  };
  for (const project of state.projects) register(project, project.id, 'Project');
  for (const dataset of state.datasets) {
    register(dataset, dataset.projectId, 'Dataset');
    for (const record of dataset.records) {
      if (record.datasetId !== dataset.id) throw new Error(`Invalid workspace backup: source ${record.id} belongs to another dataset.`);
      register(record, dataset.projectId, 'Source');
    }
  }
  for (const finding of state.findings) register(finding, finding.projectId, 'Finding');
  for (const requirement of state.requirements) register(requirement, requirement.projectId, 'Requirement');
  for (const request of state.requests) register(request, request.projectId, 'Evidence request');
  for (const run of state.runs) register(run, run.projectId, 'Analysis');
  for (const event of state.audit) register(event, event.projectId, 'Audit');

  const reference = (owner:string, projectId:string, target:string, kind?:string) => {
    const item = known.get(target);
    if (!item || (kind && item.kind !== kind)) throw new Error(`Invalid workspace backup: ${owner} references unknown ${kind ?? 'record'} ${target}.`);
    if (item.projectId !== projectId) throw new Error(`Invalid workspace backup: ${owner} has a cross-project reference to ${target}.`);
  };
  for (const finding of state.findings) {
    for (const source of [...finding.sources, ...finding.contradictions]) reference(finding.id, finding.projectId, source, 'Source');
    if (finding.sources.some(source => finding.contradictions.includes(source))) throw new Error(`Invalid workspace backup: ${finding.id} repeats a source as support and contradiction.`);
    if (finding.runId) reference(finding.id, finding.projectId, finding.runId, 'Analysis');
  }
  for (const requirement of state.requirements) {
    for (const finding of requirement.findings) reference(requirement.id, requirement.projectId, finding, 'Finding');
    if (requirement.priorityOverride && !requirement.overrideReason?.trim()) throw new Error(`Invalid workspace backup: ${requirement.id} has an undocumented priority override.`);
    if (requirement.history.length !== requirement.version - 1) throw new Error(`Invalid workspace backup: ${requirement.id} has incomplete version history.`);
    if (Date.parse(requirement.updatedAt) < Date.parse(requirement.createdAt)) throw new Error(`Invalid workspace backup: ${requirement.id} has invalid version dates.`);
    let previousAt = Date.parse(requirement.createdAt);
    for (const [index, version] of requirement.history.entries()) {
      if (version.version !== index + 1 || version.modelVersion > state.model.version) throw new Error(`Invalid workspace backup: ${requirement.id} has invalid historical version numbers.`);
      const at = Date.parse(version.at);
      if (at < previousAt || at > Date.parse(requirement.updatedAt)) throw new Error(`Invalid workspace backup: ${requirement.id} has unordered version dates.`);
      previousAt = at;
      for (const finding of version.findings ?? []) reference(requirement.id, requirement.projectId, finding, 'Finding');
    }
  }
  for (const request of state.requests) reference(request.id, request.projectId, request.requirementId, 'Requirement');
  for (const run of state.runs) {
    for (const dataset of run.datasets) reference(run.id, run.projectId, dataset, 'Dataset');
    for (const finding of run.findingIds) reference(run.id, run.projectId, finding, 'Finding');
    for (const requirement of run.requirementIds) reference(run.id, run.projectId, requirement, 'Requirement');
  }
  for (const event of state.audit) {
    if (event.entityType === 'Scoring model') {
      const version = Number(/^MODEL-(\d+)$/.exec(event.entityId)?.[1]);
      if (!Number.isSafeInteger(version) || version < 1 || version > state.model.version) throw new Error(`Invalid workspace backup: ${event.id} references an unknown scoring model.`);
    } else reference(event.id, event.projectId, event.entityId, event.entityType);
    for (const related of event.relatedIds) reference(event.id, event.projectId, related);
    if (event.runId) reference(event.id, event.projectId, event.runId, 'Analysis');
    if (event.entityType === 'Requirement' && event.version && event.version > state.requirements.find(requirement => requirement.id === event.entityId)!.version) throw new Error(`Invalid workspace backup: ${event.id} references an unknown requirement version.`);
  }
  return state;
}

export function parseWorkspaceBackup(raw:string):Workspace {
  if (new Blob([raw]).size > MAX_BACKUP_BYTES) throw new Error('Workspace backups must be smaller than 50 MB.');
  let input:unknown;
  try { input = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error('This file is not valid JSON. Choose a workspace JSON backup exported from InsightPilot.'); }
  return validateWorkspaceBackup(input);
}

export function backupSummary(state:Workspace) {
  return {projects:state.projects.length, datasets:state.datasets.length, records:state.datasets.reduce((sum, dataset) => sum + dataset.records.length, 0), findings:state.findings.length, requirements:state.requirements.length, audit:state.audit.length, revision:state.revision, modelVersion:state.model.version};
}

/** Escape spreadsheet formula triggers as well as CSV separators and quotes. */
export function csvCell(value:unknown):string {
  let content = value === null || value === undefined ? '' : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/.test(content) || /^[\t\r\n]/.test(content)) content = "'" + content;
  return `"${content.replaceAll('"', '""')}"`;
}

export function requirementPortfolioCsv(state:Workspace, projectId?:string):string {
  const header = ['Requirement ID','Project','Derivative','Market','Horizon','Title','Statement','Category','Status','Priority','Weighted score','Customer impact','Frequency of need','Strategic relevance','Evidence strength','Feasibility','Confidence (%)','Finding IDs','Supporting source IDs','Assumptions','Uncertainty','Rationale','Priority override reason','Version','Scoring model version','Synthetic','Created at','Updated at'];
  const rows = state.requirements.filter(requirement => !projectId || requirement.projectId === projectId).map(requirement => {
    const project = state.projects.find(item => item.id === requirement.projectId)!;
    const score = scoreRequirement(requirement.scores, state.model);
    const sources = [...new Set(state.findings.filter(finding => requirement.findings.includes(finding.id) && finding.projectId === requirement.projectId && finding.status !== 'Excluded').flatMap(finding => finding.sources))];
    return [requirement.id, project.name, project.derivative, project.market, project.horizon, requirement.title, requirement.statement, requirement.category, requirement.status, requirement.priorityOverride ?? priorityFor(score, state.model) ?? 'Unscored', score, ...dimensions.map(dimension => requirement.scores[dimension] ?? 'Unknown'), requirement.confidence, requirement.findings.join('; '), sources.join('; '), requirement.assumptions, requirement.uncertainty, requirement.rationale, requirement.overrideReason ?? '', requirement.version, state.model.version, requirement.synthetic ? 'Yes' : 'No', requirement.createdAt, requirement.updatedAt];
  });
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
