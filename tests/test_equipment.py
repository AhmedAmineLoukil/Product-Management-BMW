"""Checks for the manually curated equipment output. Run after both scripts."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / 'data' / 'processed'

@unittest.skipUnless((PROCESSED / 'equipment.jsonl').exists(), 'Private equipment fixture unavailable')
class EquipmentChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with (PROCESSED / 'equipment.jsonl').open(encoding='utf-8') as f:
            cls.records = [json.loads(line) for line in f if line.strip()]

    def test_ids(self):
        self.assertGreaterEqual(len(self.records), 10)
        self.assertEqual(len(self.records), len({r['source_id'] for r in self.records}))

    def test_all_have_source_references(self):
        self.assertTrue(all(r['source_ref'].startswith('F70_OptionList.PDF#page=') for r in self.records))
        self.assertTrue(all(r['market_scope'] == 'DE' for r in self.records))
        self.assertTrue(all(r['feature_name_original'] and r['source_text_match'] for r in self.records))

    def test_package_components_have_codes(self):
        self.assertTrue(all(r['included_in_package_codes'] for r in self.records if r['availability']=='included_with_package'))
        self.assertTrue(all(r['availability'] in {'standard','optional','included_with_package','unknown'} for r in self.records))

if __name__ == '__main__':
    unittest.main()
