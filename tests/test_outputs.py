"""Integration checks against the particular BMW files supplied for the hackathon."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / 'data' / 'processed'


def load_jsonl(filename):
    path = PROCESSED / filename
    with path.open(encoding='utf-8') as f:
        return [json.loads(x) for x in f if x.strip()]


@unittest.skipUnless(all((PROCESSED / name).exists() for name in
                        ['feedback.jsonl', 'study_eu.jsonl', 'sales.jsonl', 'catalog_pages.jsonl']),
                     'Private BMW integration fixtures unavailable')
class BMWIngestionChecks(unittest.TestCase):
    def test_feedback_deduplication(self):
        records = load_jsonl('feedback.jsonl')
        self.assertEqual(len(records), 2128)
        ids = [r['feedback_id'] for r in records]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(sum(len(r['annotations']) for r in records), 4076)
        self.assertFalse(any(r['country_code'] == 'DE' for r in records))
        self.assertTrue(any(len(r['annotations']) > 1 for r in records))

    def test_study(self):
        records = load_jsonl('study_eu.jsonl')
        self.assertEqual(len(records), 37)
        self.assertTrue(all(r['market_scope'] == 'EU' for r in records))
        overall = next(r for r in records if r['metric'] == 'Overall product satisfaction')
        self.assertAlmostEqual(overall['value'], 8.46293728005414)
        self.assertEqual(overall['source_cell'], 'CN_EU_2025!D4')

    def test_sales(self):
        records = load_jsonl('sales.jsonl')
        self.assertEqual(len(records), 12)
        eu2025 = next(r for r in records if r['market_code']=='EU' and r['year']==2025)
        self.assertEqual(eu2025['volume'], 85000)
        self.assertEqual(eu2025['source_cell'], 'F70!D2')
        self.assertTrue(all(r['value_class'] == 'future_value_unspecified' for r in records if r['year'] == 2030))

    def test_catalog(self):
        records = load_jsonl('catalog_pages.jsonl')
        self.assertEqual(len(records), 23)
        p16 = next(r for r in records if r['page']==16)
        self.assertIn('PREMIUM PAKET', p16['text_original'])
        self.assertEqual(p16['source_ref'], 'F70_OptionList.PDF#page=16')


if __name__ == '__main__':
    unittest.main()
