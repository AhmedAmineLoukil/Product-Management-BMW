/** The three product choices in the challenge. Chassis codes remain source metadata. */
export const seriesChoices = ['1', '5', '7'] as const;
export type Series = typeof seriesChoices[number];
export const marketChoices = ['Europe', 'United States', 'China'] as const;
export type Market = typeof marketChoices[number];

export function modelFor(series: Series, market: Market): 'F70' | 'G60' | 'G68' | 'G70' {
 if (series === '1') return 'F70';
 if (series === '7') return 'G70';
 return market === 'China' ? 'G68' : 'G60';
}

export function seriesFor(derivative: string): Series | null {
 if (/\b(?:F70|1 Series)\b/i.test(derivative)) return '1';
 if (/\b(?:G60|G68|5 Series)\b/i.test(derivative)) return '5';
 if (/\b(?:G70|7 Series)\b/i.test(derivative)) return '7';
 return null;
}

export function derivativeFor(series: Series, market: Market): string {
 return `BMW ${series} Series ${modelFor(series, market)}`;
}
