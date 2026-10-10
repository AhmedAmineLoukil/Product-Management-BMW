# Grouping method comparison

Run `./.venv/bin/python scripts/benchmark_grouping.py` to reproduce this synthetic benchmark. The input has 24 findings: two different phrasings of the same seat-comfort concern for each of F70, G60, G68, and G70 in three separate markets. A correct result has 12 pairs: the two paraphrases in each vehicle/market scope. The test is deliberately small so that a PM can inspect the expected answer.

Measured on this Mac on 10 October 2026:

| Method | Time per 24-finding run | Groups | API calls in benchmark | Pair precision | Pair recall | Wrong cross-market pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original lexical similarity from `feature/ai-engine` | 0.324 ms | 8 | 0 | 0% | 0% | 24 |
| Exact text within vehicle/market scope | 0.003 ms | 24 | 0 | n/a (no pairs) | 0% | 0 |
| Scope-isolated semantic grouping with a deterministic mock | 4.639 ms | 12 | 12 mock calls | 100% | 100% | 0 |

These are local CPU measurements, not OpenAI latency. The semantic mock is given the intended grouping and **does not establish real model accuracy**. Actual provider calls: **0**; actual input/output tokens: **0**; actual cost: **not measured**. Python and frontend checks exercise structured outputs with fakes. A live run will record the real elapsed time, API calls, and token usage in Analysis history once a key is supplied. It also needs manual review of grouping errors and usefulness before any general accuracy claim.

The current live method first isolates vehicle, market, category, and finding type. A singleton scope stays alone without a clustering API call. Multi-finding scopes go to the semantic grouping model; membership is checked and source IDs are derived from validated findings. If grouping fails, findings remain separate and the run carries a warning. This retains the ability to join paraphrases while preventing the cross-market errors observed in the original lexical approach. Extraction can process up to three records concurrently by default (configurable with `AI_EXTRACT_WORKERS=1..4`); output ordering and quote checks are preserved. It is a throughput choice, not a measured claim about provider speed.

The offline **Run demo analysis** button uses deterministic keyword topics and zero API calls. It is very fast and fully inspectable, but a keyword hit can misread sentiment or need. Its findings therefore say they need validation, and any derived requirement remains unapproved. Live AI uses more calls and can interpret paraphrases; exact quotes and record IDs are checked, yet interpretation and representativeness remain human work.
