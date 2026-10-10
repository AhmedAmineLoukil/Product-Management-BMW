# Public source register

Checked on 10 October 2026. These are public research sources, separate from the supplied private BMW customer files. An official product announcement describes equipment or market positioning; it is **not** a customer review. A safety complaint is an owner report, not a representative satisfaction survey. The collector retains the exact source URL, retrieved date, original text, source type, and model-match warning for each imported record.

| Market | Vehicle | Source | Use in app | Limitation |
| --- | --- | --- | --- | --- |
| Europe | F70 1 Series | [BMW PressClub 1 Series launch](https://www.press.bmwgroup.com/global/article/detail/T0442625EN/the-all-new-bmw-1-series) | Fetch as official product context | Global announcement; verify local equipment. |
| Europe | F70 1 Series | [Euro NCAP 2025 BMW 1 Series assessment](https://www.euroncap.com/assessments/bmw/1-series/1125/) | Open as reference database | No documented public API was confirmed; not scraped. |
| Europe | G60 5 Series | [BMW PressClub G60 announcement](https://www.press.bmwgroup.com/global/article/detail/T0410858EN/digital-dynamic-and-now-also-fully-electric%3A-the-bmw-5-series-enters-a-new-era?language=en) | Fetch as official product context | Broad model announcement. |
| Europe | G60 5 Series | [Euro NCAP BMW 5 Series assessment](https://www.euroncap.com/assessments/bmw/5-series/1032/) | Open as reference database | No documented public API was confirmed; not scraped. |
| Europe | G70 7 Series | [BMW PressClub G70 announcement](https://www.press.bmwgroup.com/global/article/detail/T0380173EN/the-new-bmw-7-series?language=en) | Fetch as official product context | Article includes several regional variants. |
| United States | G60 5 Series | [BMW PressClub USA G60 launch](https://www.press.bmwgroup.com/usa/article/detail/T0418778EN_US/the-all-new-2024-bmw-5-series?language=en_US) | Fetch as official product context | Manufacturer claim, not owner evidence. |
| United States | G70 7 Series | [BMW PressClub USA G70 launch](https://www.press.bmwgroup.com/usa/article/detail/T0382613EN_US/the-new-bmw-7-series?language=en_US) | Fetch as official product context | Manufacturer claim, not owner evidence. |
| United States | G60/G70 5/7 Series | [NHTSA complaints API documentation](https://www.nhtsa.gov/nhtsa-datasets-and-apis) | Query selected 2024/2025 US sales model and year, preview and import exact ODI reports | NHTSA names do not prove chassis codes. Import omits VIN, keeps per-report ODI URL, and limits preview to 100 results. |
| China | G68 long-wheelbase 5 Series | [BMW PressClub China-specific G68 article](https://www.press.bmwgroup.com/global/article/detail/T0439257EN/market-launch-of-new-bmw-5-series-sedan-and-new-bmw-i5-sedan-from-china-for-china?language=en) | Fetch as official product context | Manufacturer claim. BMW describes G68 as developed for China. |
| China | G70 7 Series | [BMW PressClub G70 announcement](https://www.press.bmwgroup.com/global/article/detail/T0380173EN/the-new-bmw-7-series?language=en) | Fetch as broad product context | China applicability must be verified per statement. |
| China | G68/G70 | [C-NCAP official results library](https://c-ncap.org.cn/cncapAllData) | Open as reference database | No documented public API was confirmed; not scraped or automatically imported. |

The supplied F70 workbook also has feedback from Japan, Australia, South Korea, and South Africa. The challenge analysis selector intentionally contains only Europe, United States, and China; those other countries are not silently reclassified. Europe includes supplied GB, SE, FR, DK, FI, DE country records and EU regional measures. Every imported record keeps its original `source_market_code` and an `analysis_market_code` for filtering. The German catalog does not establish equipment availability across Europe.

The sales workbook labels G60/G68 values as a combined series total. The app keeps that warning and does not claim that those values are sales of either chassis alone. F70 USA/China and G68 Europe/USA views are sparse sales context, not proof that those market-specific vehicles were offered there.
