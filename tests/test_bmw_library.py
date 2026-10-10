"""Synthetic adapter checks and optional local-file coverage checks."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from src.backend.services import bmw_library


def workbook(path: Path, *, conflicting=False):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Feedback_Explorer'
    sheet.append(['ID', 'Source', 'Brand', 'Sales Description', 'Country',
                  'Derivate (e-code)', 'Engine Type', 'Feedback Type',
                  'Customer Feedback', 'Vfc level2 3 Name', 'Vfc level2 Name', 'Vfc level3 Name'])
    sheet.append(['A1', 'survey', 'BMW', '1 Series', 'GB', 'F70', 'petrol',
                  'Likes', 'The seat is comfortable.', '', 'Comfort', 'Seat'])
    sheet.append(['A1', 'survey', 'BMW', '1 Series', 'GB', 'F70', 'petrol',
                  'Wants', 'The seat is uncomfortable.' if conflicting else 'The seat is comfortable.',
                  '', 'Comfort', 'Seat'])
    book.save(path)


class BmwLibraryTests(unittest.TestCase):
    def test_repeated_annotation_rows_become_one_traceable_comment(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(bmw_library, 'RAW', Path(temp)):
            workbook(Path(temp) / bmw_library.FILES['feedback'])
            records = bmw_library._feedback()[('F70', 'GB')]
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]['content'], 'The seat is comfortable.')
            self.assertEqual([a['row'] for a in records[0]['fields']['annotations']], [2, 3])
            self.assertEqual(records[0]['fields']['source_market_code'], 'GB')

    def test_conflicting_repeated_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(bmw_library, 'RAW', Path(temp)):
            workbook(Path(temp) / bmw_library.FILES['feedback'], conflicting=True)
            with self.assertRaisesRegex(ValueError, 'conflicting text'):
                bmw_library._feedback()

    def test_real_files_cover_distinct_scopes_without_relabeling(self):
        if not all((bmw_library.RAW / name).exists() for name in bmw_library.FILES.values()):
            self.skipTest('Private BMW files are not present in ignored data/raw/.')
        source = bmw_library.manifest()
        by_scope = {(s['model_code'], s['market_code']): s for s in source['scopes']}
        self.assertEqual(len(source['scopes']), 9)
        self.assertEqual({s['series'] for s in source['scopes']}, {'1', '5', '7'})
        self.assertNotIn(('G60', 'CN'), by_scope)
        self.assertNotIn(('G68', 'EU'), by_scope)
        self.assertEqual({market for _, market in by_scope}, {'EU', 'US', 'CN'})
        self.assertGreater(by_scope[('F70', 'EU')]['counts']['feedback'], 0)
        self.assertGreater(by_scope[('F70', 'EU')]['counts']['equipment'], 0)
        self.assertGreater(by_scope[('G68', 'CN')]['counts']['studies'], 0)
        self.assertGreater(by_scope[('G60', 'US')]['counts']['studies'], 0)
        eu = bmw_library.load_scope('F70', 'EU')
        original_markets = {r['fields']['source_market_code'] for d in eu['datasets'] for r in d['records']}
        self.assertIn('GB', original_markets)
        self.assertIn('DE', original_markets)
        self.assertIn('EU', original_markets)
        self.assertNotIn('JP', original_markets)
        self.assertTrue(all(r['fields']['analysis_market_code'] == 'EU'
                            for d in eu['datasets'] for r in d['records']))
        cn = bmw_library.load_scope('G68', 'CN')
        combined = [r for d in cn['datasets'] if d['kind'] == 'sales' for r in d['records']]
        self.assertTrue(combined and all(r['fields']['combined_model_scope'] for r in combined))
        self.assertTrue(any(r['fields']['future_value'] for r in combined))
        with self.assertRaises(ValueError):
            bmw_library.load_scope('G60', 'CN')


if __name__ == '__main__':
    unittest.main()
