"""Conservative public-page collector for model context and editorial reviews.

Only a user-selected page or one BMW PressClub source is fetched. The result is
reviewed before import and is never represented as BMW customer feedback.
"""
from __future__ import annotations

import hashlib
import fcntl
import ipaddress
import json
import re
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

PRESETS = {
    'F70': 'https://www.press.bmwgroup.com/global/article/detail/T0442625EN/the-all-new-bmw-1-series',
    'G60': 'https://www.press.bmwgroup.com/canada/article/detail/T0437821EN/market-launch-of-the-new-bmw-5-series-sedan-and-the-first-bmw-i5',
    'G68': 'https://www.press.bmwgroup.com/global/article/detail/T0439257EN/market-launch-of-new-bmw-5-series-sedan-and-new-bmw-i5-sedan-from-china-for-china?language=en',
    'G70': 'https://www.press.bmwgroup.com/global/article/detail/T0380173EN/the-new-bmw-7-series',
}
USER_AGENT = 'BMWInsightPilotResearch/1.0 (public research; contact repo maintainers)'
CACHE = Path('data/local/collector_cache')

def _rate_limit(host: str) -> None:
    """Permit at most one request per host per second, even across bridge processes."""
    CACHE.mkdir(parents=True, exist_ok=True)
    marker = CACHE / ('host-' + hashlib.sha256(host.encode()).hexdigest()[:16] + '.rate')
    with marker.open('a+') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        try:
            last = float(handle.read() or '0')
        except ValueError:
            last = 0
        delay = 1 - (time.time() - last)
        if delay > 0:
            time.sleep(delay)
        handle.seek(0)
        handle.truncate()
        handle.write(str(time.time()))
        handle.flush()
        fcntl.flock(handle, fcntl.LOCK_UN)


def _public_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname or parts.port or parts.username or parts.password:
        raise ValueError('Use a public HTTPS URL without credentials or a custom port.')
    if parts.hostname.endswith(('.local', '.internal')):
        raise ValueError('Local network addresses are not allowed.')
    try:
        addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError('The source host could not be resolved.') from exc
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('Only public Internet hosts are allowed.')
    return url


def _get(url: str, session: requests.Session) -> tuple[str, str]:
    url = _public_url(url)
    for _ in range(4):
        host = urlsplit(url).hostname or ''
        robot_url = f'https://{host}/robots.txt'
        try:
            _rate_limit(host)
            robot = session.get(robot_url, headers={'User-Agent': USER_AGENT}, timeout=8, allow_redirects=False)
        except requests.RequestException as exc:
            raise ValueError('Could not check the site robots policy.') from exc
        if robot.status_code == 200:
            parser = RobotFileParser()
            parser.parse(robot.text[:100_000].splitlines())
            if not parser.can_fetch(USER_AGENT, url):
                raise ValueError('This site does not permit this automated fetch.')
        elif robot.status_code not in (404, 410):
            raise ValueError('Could not confirm that the site permits this fetch.')
        try:
            _rate_limit(host)
            response = session.get(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html'}, timeout=12,
                                   allow_redirects=False, stream=True)
        except requests.RequestException as exc:
            raise ValueError('The page could not be fetched.') from exc
        if response.status_code in (301, 302, 303, 307, 308):
            target = response.headers.get('Location')
            response.close()
            if not target:
                raise ValueError('The site returned a redirect without a destination.')
            url = _public_url(urljoin(url, target))
            continue
        if response.status_code != 200:
            response.close()
            raise ValueError(f'The source returned HTTP {response.status_code}.')
        if 'text/html' not in response.headers.get('Content-Type', '').lower():
            response.close()
            raise ValueError('The source is not an HTML page.')
        content = bytearray()
        for chunk in response.iter_content(16_384):
            content.extend(chunk)
            if len(content) > 700_000:
                response.close()
                raise ValueError('The page exceeds the collector size limit.')
        response.close()
        return url, content.decode(response.encoding or 'utf-8', errors='replace')
    raise ValueError('Too many redirects.')


def _nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from _nodes(item)
    elif isinstance(value, dict):
        yield value
        if '@graph' in value:
            yield from _nodes(value['@graph'])


def _schema_types(node):
    raw = node.get('@type', [])
    return {str(x).split('/')[-1].lower() for x in (raw if isinstance(raw, list) else [raw])}


def _clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def extract_page(html: str, url: str, model_code: str, market: str) -> dict:
    if model_code not in PRESETS:
        raise ValueError('Choose F70, G60, G68, or G70.')
    soup = BeautifulSoup(html, 'html.parser')
    title = _clean((soup.find('h1') or soup.find('title')).get_text(' ', strip=True) if soup.find('h1') or soup.find('title') else '')
    for element in soup(['script', 'style', 'nav', 'footer', 'header']):
        if element.name != 'script' or element.get('type') != 'application/ld+json':
            element.decompose()
    schemas = []
    for tag in soup.find_all('script', {'type': 'application/ld+json'}):
        try:
            schemas.extend(_nodes(json.loads(tag.string or tag.get_text())))
        except (ValueError, TypeError):
            continue
    published = next((_clean(n.get('datePublished')) for n in schemas if n.get('datePublished')), None)
    if not published:
        meta = soup.find('meta', attrs={'property': 'article:published_time'}) or soup.find('meta', attrs={'name': 'date'})
        published = _clean(meta.get('content')) if meta else None
    if not published:
        press_date = soup.select_one('span.date')
        if press_date:
            visible_date = _clean(press_date.get_text(' ', strip=True))
            try:
                published = datetime.strptime(re.sub(r'\s+(?:CET|CEST)\s+', ' ', visible_date),
                                              '%a %b %d %H:%M:%S %Y').date().isoformat()
            except ValueError:
                pass
    candidates = []
    for node in schemas:
        if 'review' in _schema_types(node):
            body = _clean(node.get('reviewBody') or node.get('description'))
            if body:
                candidates.append(('editorial_review', body, _clean(node.get('datePublished')) or published))
    if not candidates:
        article = next((n for n in schemas if 'article' in _schema_types(n) or 'newsarticle' in _schema_types(n)), None)
        body = _clean(article.get('articleBody')) if article else ''
        if not body:
            container = soup.find('article') or soup.find('main')
            body = _clean(' '.join(p.get_text(' ', strip=True) for p in container.find_all('p'))) if container else ''
        if not body:
            meta = soup.find('meta', attrs={'name': 'description'})
            body = _clean(meta.get('content')) if meta else ''
        if body:
            kind = 'official_model_info' if urlsplit(url).hostname == 'www.press.bmwgroup.com' else 'editorial_review' if 'review' in title.lower() else 'external_article'
            candidates.append((kind, body, published))
    if not candidates:
        raise ValueError('No readable article or structured review was found.')
    keywords = ' '.join(_clean(tag.get('content')) for tag in soup.find_all('meta', attrs={'name': 'keywords'}))
    combined = (title + ' ' + ' '.join(item[1] for item in candidates) + ' ' + keywords).lower()
    aliases = {'F70': ('bmw 1 series', 'bmw 1er'),
               'G60': ('bmw 5 series', 'bmw 5er', 'bmw i5'),
               'G68': ('bmw 5 series long wheelbase', 'bmw 5 series sedan from china'),
               'G70': ('bmw 7 series', 'bmw 7er', 'bmw i7')}
    exact = bool(re.search(r'\b' + re.escape(model_code.lower()) + r'\b', combined))
    alias = next((a for a in aliases[model_code] if a in combined), None)
    if not exact and not alias:
        raise ValueError(f'The page does not mention {model_code} or a matching BMW model name. Check the URL.')
    retrieved = datetime.now(timezone.utc).isoformat()
    records = []
    for kind, body, date in candidates[:10]:
        text = body
        digest = hashlib.sha256((model_code + '\n' + market + '\n' + url + '\n' + text.casefold()).encode()).hexdigest()[:20]
        records.append({'source_id': 'WEB-' + digest, 'model_code': model_code,
                        'requested_market': market, 'source_market': 'Not verified from page',
                        'source_type': kind, 'source_url': url, 'title': title or url,
                        'published_at': date, 'retrieved_at': retrieved,
                        'text_original': text,
                        'model_match': model_code if exact else alias,
                        'model_match_quality': 'exact_code' if exact else 'name_only_variant_unverified'})
    return {'model_code': model_code, 'market': market, 'source_url': url,
            'records': records, 'warning': 'External context only. Model and market applicability require PM review; do not treat this as BMW customer feedback.'}


def collect(url: str | None, model_code: str, market: str, *, session=None, use_cache=True) -> dict:
    if model_code not in PRESETS:
        raise ValueError('Choose F70, G60, G68, or G70.')
    if not isinstance(market, str) or not market.strip() or len(market) > 80:
        raise ValueError('Enter a market label.')
    selected = url.strip() if isinstance(url, str) and url.strip() else PRESETS[model_code]
    if len(selected) > 2_000:
        raise ValueError('URL is too long.')
    key = hashlib.sha256(('v2\n' + model_code + '\n' + market + '\n' + selected).encode()).hexdigest()
    cache_file = CACHE / f'{key}.json'
    if use_cache and cache_file.exists() and time.time() - cache_file.stat().st_mtime < 86_400:
        cached = json.loads(cache_file.read_text())
        if cached.get('model_code') == model_code and cached.get('market') == market:
            cached['cached'] = True
            return cached
    final_url, html = _get(selected, session or requests.Session())
    result = extract_page(html, final_url, model_code, market)
    if use_cache:
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(result, ensure_ascii=False))
    result['cached'] = False
    return result
