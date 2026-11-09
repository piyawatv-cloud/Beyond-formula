"""Synthetic browser tests; fetch pinned, hash-verified GitHub helpers only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
HELPERS = {'chat-journal-browser.mjs':'7efdaff01cd53addc54c410938e304e147962f7196f02d6796b4e87e075ca23a',
           'browser-downloads.mjs':'abd514df4bd4d9ee443c76e766dc183c586a26efd7da224299c4e02e3d18da9a'}
TESTS = ['save-inflight', 'drawer-keyboard', 'import-retry', 'brief-calculation', 'role-journey', 'import-edit', 'unload', 'chat-draft', 'activity-dash', 'web-workflow', 'live-ui', 'oversea-mkt', 'create-form-parity']
with tempfile.TemporaryDirectory(prefix='formula-browser-helper-') as temp:
    for name, checksum in HELPERS.items():
        uri = f'repos/piyawatv-cloud/formula-runtime/contents/tests/helpers/{name}?ref=91d5fde5a17abf70d9ac5764b6b31529d69f913c'
        response = subprocess.run(['gh', 'api', uri], capture_output=True, text=True, check=True)
        content = json.loads(response.stdout)
        if content.get('encoding') != 'base64' or not isinstance(content.get('content'), str):
            raise RuntimeError('unexpected browser helper response')
        helper_bytes = base64.b64decode(content['content'])
        if hashlib.sha256(helper_bytes).hexdigest() != checksum:
            raise RuntimeError('unexpected browser helper hash')
        Path(temp, name).write_bytes(helper_bytes)
    helper = Path(temp, 'chat-journal-browser.mjs')
    env = {'PATH': os.environ['PATH'], 'FORMULA_BROWSER_TEST_REQUIRED': '1', 'FORMULA_TEST_BROWSER_HELPER_URL': helper.as_uri()}
    if os.environ.get('FORMULA_BROWSER_TEST_CHROME'):
        env['FORMULA_BROWSER_TEST_CHROME'] = os.environ['FORMULA_BROWSER_TEST_CHROME']
    result = subprocess.run(['node', '--test', '--test-concurrency=2', *[str(HERE / (name + '-native.test.mjs')) for name in TESTS]], env=env)
    raise SystemExit(result.returncode)
