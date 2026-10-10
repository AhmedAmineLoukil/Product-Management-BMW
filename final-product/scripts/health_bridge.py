"""Local dependency readiness only. No provider requests and no credential output."""
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def health():
    dependencies = {}
    issues = []
    for service, modules in {
        'chat': ('openai', 'src.ai.assistant'),
        'analysis': ('openai', 'src.backend.services.analysis_service'),
        'collector': ('src.backend.services.collector',),
    }.items():
        try:
            for module in modules:
                importlib.import_module(module)
            dependencies[service] = True
        except Exception:
            dependencies[service] = False
            issues.append(f'{service.capitalize()} dependencies are unavailable. Install requirements.txt and restart the app.')
    return {'pythonReady': True, 'dependencies': dependencies, 'issues': issues}


if __name__ == '__main__':
    print(json.dumps(health()))
