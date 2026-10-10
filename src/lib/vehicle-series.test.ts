import {describe,expect,it} from 'vitest';
import {derivativeFor,marketChoices,modelFor,seriesChoices,seriesFor} from './vehicle-series';

describe('three-series vehicle selection',()=>{
 it('maps each market to one source model',()=>{
  expect(seriesChoices).toEqual(['1','5','7']);
  expect(marketChoices).toEqual(['Europe','United States','China']);
  expect(modelFor('1','Europe')).toBe('F70');
  expect(modelFor('5','Europe')).toBe('G60');
  expect(modelFor('5','United States')).toBe('G60');
  expect(modelFor('5','China')).toBe('G68');
  expect(modelFor('7','China')).toBe('G70');
  expect(derivativeFor('5','China')).toBe('BMW 5 Series G68');
  expect(seriesFor('BMW 5 Series G68')).toBe('5');
 });
});
