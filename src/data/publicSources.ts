export type AnalysisMarket='Europe'|'United States'|'China';
export const analysisMarkets:AnalysisMarket[]=['Europe','United States','China'];

export const pressPages:Record<string,string>={
 'F70:Europe':'https://www.press.bmwgroup.com/global/article/detail/T0442625EN/the-all-new-bmw-1-series',
 'G60:Europe':'https://www.press.bmwgroup.com/global/article/detail/T0410858EN/digital-dynamic-and-now-also-fully-electric%3A-the-bmw-5-series-enters-a-new-era?language=en',
 'G60:United States':'https://www.press.bmwgroup.com/usa/article/detail/T0418778EN_US/the-all-new-2024-bmw-5-series?language=en_US',
 'G68:China':'https://www.press.bmwgroup.com/global/article/detail/T0439257EN/market-launch-of-new-bmw-5-series-sedan-and-new-bmw-i5-sedan-from-china-for-china?language=en',
 'G70:Europe':'https://www.press.bmwgroup.com/global/article/detail/T0380173EN/the-new-bmw-7-series?language=en',
 'G70:United States':'https://www.press.bmwgroup.com/usa/article/detail/T0382613EN_US/the-new-bmw-7-series?language=en_US',
 'G70:China':'https://www.press.bmwgroup.com/global/article/detail/T0380173EN/the-new-bmw-7-series?language=en',
};

export const researchLibraries=[
 {market:'Europe',name:'Euro NCAP · BMW 1 Series (2025)',url:'https://www.euroncap.com/assessments/bmw/1-series/1125/',model:'F70',note:'Safety assessment; open and review before citing.'},
 {market:'Europe',name:'Euro NCAP · BMW 5 Series (2023)',url:'https://www.euroncap.com/assessments/bmw/5-series/1032/',model:'G60',note:'Safety assessment; open and review before citing.'},
 {market:'United States',name:'NHTSA complaints API',url:'https://www.nhtsa.gov/nhtsa-datasets-and-apis',model:'G60',note:'Structured owner safety complaints; selectable collector above.'},
 {market:'United States',name:'NHTSA complaints API',url:'https://www.nhtsa.gov/nhtsa-datasets-and-apis',model:'G70',note:'Structured owner safety complaints; selectable collector above.'},
 {market:'China',name:'C-NCAP official results',url:'https://c-ncap.org.cn/cncapAllData',model:'G68',note:'Official result library; manual review until a documented API is available.'},
 {market:'China',name:'C-NCAP official results',url:'https://c-ncap.org.cn/cncapAllData',model:'G70',note:'Official result library; manual review until a documented API is available.'},
];
