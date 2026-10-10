"""Adapter for BMW wide metric/Mean study sheets; unknown layouts fail closed."""
from pathlib import Path
import re
from .loader import stable_id


def read_bmw_studies(path, *, market, vehicles=('F70', 'G60', 'G70')):
    """Discover vehicle columns, not fixed F70 column D. Scope is caller supplied.

    Rows labelled Mean are associated with the preceding metric label. No scale,
    sample size, or satisfaction interpretation is inferred from numeric values.
    """
    import pandas as pd
    from openpyxl.utils import get_column_letter
    if not market:
        raise ValueError('Explicit study market scope required')
    result = []
    for sheet, frame in pd.read_excel(path, sheet_name=None, header=None, keep_default_na=False).items():
        columns = {}
        for row_index in range(min(10, len(frame))):
            for column in range(1, len(frame.columns)):
                value = str(frame.iat[row_index, column])
                for vehicle in vehicles:
                    if re.search(r'\b' + re.escape(vehicle) + r'\b', value):
                        if vehicle in columns and columns[vehicle] != column:
                            raise ValueError('Ambiguous duplicate study vehicle columns')
                        columns[vehicle] = column
        for index in range(1, len(frame)):
            if str(frame.iat[index, 0]).strip().lower() != 'mean':
                continue
            metric = str(frame.iat[index - 1, 0]).strip()
            if not metric:
                raise ValueError('Study Mean row has no preceding metric label')
            for vehicle, column in columns.items():
                raw = frame.iat[index, column]
                if raw == '' or pd.isna(raw):
                    continue
                cell = f'{sheet}!{get_column_letter(column + 1)}{index + 1}'
                result.append({'record_type': 'customer_study_metric',
                               'source_id': stable_id('STUDY', Path(path).name, cell, vehicle),
                               'vehicle_code': vehicle, 'market_scope': market.upper(),
                               'metric': metric, 'statistic': 'Mean', 'value': float(raw),
                               'scale': None, 'sample_size': None,
                               'source_file': Path(path).name, 'source_sheet': sheet,
                               'source_cell': cell, 'metric_label_cell': f'{sheet}!A{index}',
                               'limitations': ['Scale, sample size and country representativeness unspecified.']})
    if not result:
        raise ValueError('No recognized vehicle columns and Mean metrics; supply an explicit layout adapter')
    return result
