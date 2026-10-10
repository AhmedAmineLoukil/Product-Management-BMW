"""Approved research ingestion. Offline by default; exact URL allowlist."""
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import URLError, HTTPError
import json
import time
from .loader import stable_id


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # Redirect destinations require their own explicit approval.


class ResearchRepository:
    def __init__(self, approved_sources, *, cache_dir='data/cache/research'):
        """approved_sources maps exact HTTPS URLs to publisher/title metadata."""
        self.approved = approved_sources
        self.cache_dir = Path(cache_dir)
        for url in approved_sources:
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Allowlist requires credential-free HTTPS URLs')

    def ingest_offline(self, *, url, text, claim, vehicle, market=None,
                       publication_date=None, limitations=(), retrieved_at=None):
        if url not in self.approved:
            raise ValueError('Research URL is not explicitly approved')
        if not isinstance(claim, str) or not claim.strip() or claim not in text:
            raise ValueError('Research claim must be an exact excerpt of supplied source text')
        metadata = self.approved[url]
        if not metadata.get('title') or not metadata.get('publisher'):
            raise ValueError('Approved source needs title and publisher')
        if publication_date is not None:
            from datetime import date
            date.fromisoformat(publication_date)
        return {'record_type': 'external_research', 'source_id': stable_id('RESEARCH', url, claim, vehicle, market),
                'title': metadata['title'], 'publisher': metadata['publisher'], 'url': url,
                'publication_date': publication_date or metadata.get('publication_date'),
                'retrieved_at': retrieved_at or datetime.now(timezone.utc).isoformat(),
                'claim': claim, 'vehicle_code': vehicle, 'market_scope': market,
                'source_ref': url, 'limitations': list(limitations) + metadata.get('limitations', []) +
                ([] if publication_date or metadata.get('publication_date') else ['Publication date unknown.']),
                'verification_status': 'needs_review', 'ingestion_mode': 'offline'}

    def fetch(self, url, *, allow_network=False, timeout=15, retries=2, refresh=False):
        """Fetch a curated document only; return bytes for local excerpt review.

        No model chooses sources or claims. Cached documents contain no BMW
        feedback; nevertheless caches remain excluded from Git.
        """
        if url not in self.approved:
            raise ValueError('Research URL is not explicitly approved')
        path = self.cache_dir / (stable_id('DOCUMENT', url) + '.bin')
        if path.is_file() and not refresh:
            return path.read_bytes()
        if not allow_network:
            raise PermissionError('Fetching approved research requires allow_network=True')
        opener = build_opener(NoRedirect())
        for attempt in range(retries + 1):
            try:
                with opener.open(Request(url, headers={'User-Agent': 'BMW-Hackathon-Research/1.0'}), timeout=timeout) as response:
                    body = response.read(25_000_001)
                    if len(body) > 25_000_000:
                        raise ValueError('Research document exceeds 25 MB limit')
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
                return body
            except (URLError, TimeoutError) as exc:
                if isinstance(exc, HTTPError) and exc.code not in {408, 429, 500, 502, 503, 504}:
                    raise
                if attempt == retries:
                    raise
                time.sleep(min(2 ** attempt, 8))

    @classmethod
    def from_config(cls, path, **kwargs):
        return cls(json.loads(Path(path).read_text(encoding='utf-8')), **kwargs)
