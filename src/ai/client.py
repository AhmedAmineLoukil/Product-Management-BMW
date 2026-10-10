"""Authorized SDK wrapper: private local cache, usage accounting, bounded retries."""
from pathlib import Path
from types import SimpleNamespace
import json
import os
import time
from src.data.loader import stable_id


class ManagedClient:
    def __init__(self, client, *, model=None, cache_dir=None, retries=2,
                 input_price_per_million=None, output_price_per_million=None):
        self.client = client
        self.model = model or os.getenv('OPENAI_MODEL', 'gpt-5.6-luna')
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.retries = retries
        self.prices = (input_price_per_million, output_price_per_million)
        self.responses = self
        self.usage = {'requests': 0, 'cache_hits': 0, 'input_tokens': 0, 'output_tokens': 0,
                      'estimated_cost_usd': None, 'usage_available': False}

    def parse(self, **kwargs):
        from openai import APIConnectionError, APITimeoutError, APIStatusError
        kwargs.update(model=self.model, store=False)
        schema = kwargs['text_format']
        key = stable_id('CACHE', self.model, schema.model_json_schema(), kwargs['instructions'], kwargs['input'])
        path = self.cache_dir / (key + '.json') if self.cache_dir else None
        if path and path.is_file():
            try:
                parsed = schema.model_validate_json(path.read_text(encoding='utf-8'))
                self.usage['cache_hits'] += 1
                return SimpleNamespace(output_parsed=parsed, status='completed', output=[])
            except (ValueError, OSError):
                pass
        for attempt in range(self.retries + 1):
            self.usage['requests'] += 1
            try:
                response = self.client.responses.parse(**kwargs)
                break
            except (APIConnectionError, APITimeoutError, APIStatusError) as exc:
                retryable = not isinstance(exc, APIStatusError) or exc.status_code in {408, 409, 429} or exc.status_code >= 500
                if not retryable or attempt == self.retries:
                    raise
                time.sleep(min(2 ** attempt, 8))
        usage = getattr(response, 'usage', None)
        if usage is not None:
            self.usage['usage_available'] = True
            self.usage['input_tokens'] += getattr(usage, 'input_tokens', 0) or 0
            self.usage['output_tokens'] += getattr(usage, 'output_tokens', 0) or 0
            if all(p is not None for p in self.prices):
                self.usage['estimated_cost_usd'] = (self.usage['input_tokens'] * self.prices[0] + self.usage['output_tokens'] * self.prices[1]) / 1_000_000
        if path and getattr(response, 'status', None) == 'completed' and getattr(response, 'output_parsed', None) is not None:
            parsed = schema.model_validate(response.output_parsed.model_dump())
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(parsed.model_dump_json(), encoding='utf-8')
            temporary.replace(path)
        return response


def authorized_client(*, allow_external_data_transfer=False, **options):
    if not allow_external_data_transfer:
        raise PermissionError('Explicit authorization required before sending feedback to OpenAI')
    from openai import OpenAI
    return ManagedClient(OpenAI(timeout=60, max_retries=0), **options)
