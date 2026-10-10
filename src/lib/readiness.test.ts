import {describe,expect,it} from 'vitest';
import {createSeed} from '../data/seed';
import {computeReadiness} from './readiness';

describe('hackathon readiness report',()=>{
 it('maps the workspace to the judging criteria',()=>{
  const state=createSeed(),project=state.projects[0];
  const report=computeReadiness(state,project);
  expect(report.criteria.map(c=>c.id)).toEqual([
   'decision-scoring',
   'workflow-human',
   'traceability',
   'solution-quality',
   'innovation-scale'
  ]);
  expect(report.overall).toBeGreaterThan(60);
  expect(report.metrics.pmEvents).toBeGreaterThan(0);
  expect(report.metrics.traceableRequirements).toBe(report.metrics.requirements);
 });

 it('surfaces honest gaps instead of hiding uncertainty',()=>{
  const state=createSeed(),project=state.projects[0];
  const report=computeReadiness(state,project);
  const innovation=report.criteria.find(c=>c.id==='innovation-scale');
  expect(innovation?.gaps.join(' ')).toContain('external research');
  expect(report.nextActions.join(' ')).toContain('live AI');
 });
});
