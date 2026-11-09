"""Read-only GitHub download; run only synthetic, isolated gateway/DB tests."""
import hashlib
import base64
import io
import ipaddress
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REVISION = '91d5fde5a17abf70d9ac5764b6b31529d69f913c'
PAGE_SHA = 'cf7ab7813cbe867d9d691f5f97aa2b60e8a9134aa4decc6d4c18575a2e118c64'
PROXY_SHA = '8a82dcd1a1fa6ddf2d9b5681d012bc94cc3ed163a2f3bdfb1ddc524534ee1be4'
page = ROOT / '_IT-handoff/formula-studio/app/index.html'
if page.is_file() and os.environ.get('FORMULA_TEST_PAGE_FROM_GITHUB') != '1':
    page_bytes = page.read_bytes()
else:
    response = subprocess.run(['gh', 'api', 'repos/phossatron/Beyond-formula/contents/index.html?ref=a4a6e1d29e05f67fc665e97ae572101d2c271e4f'], capture_output=True, text=True, check=True)
    content = json.loads(response.stdout)
    if content.get('encoding') != 'base64' or not isinstance(content.get('content'), str):
        raise RuntimeError('unexpected page response')
    page_bytes = base64.b64decode(content['content'])
if hashlib.sha256(page_bytes).hexdigest() != PAGE_SHA:
    raise RuntimeError('unexpected test page hash')
for image in ('postgres:16-alpine', 'postgrest/postgrest:v12.2.3'):
    subprocess.run(['docker', 'image', 'inspect', image], capture_output=True, check=True)
ids = subprocess.run(['docker', 'network', 'ls', '-q'], capture_output=True, text=True, check=True).stdout.splitlines()
networks = json.loads(subprocess.run(['docker', 'network', 'inspect', *ids], capture_output=True, text=True, check=True).stdout) if ids else []
existing = []
for network in networks:
    for config in (network.get('IPAM') or {}).get('Config') or []:
        try:
            existing.append(ipaddress.ip_network(config.get('Subnet', '')))
        except ValueError:
            pass
subnet = next((str(n) for n in ipaddress.ip_network('198.18.0.0/15').subnets(new_prefix=24)
               if all(n.version != other.version or not n.overlaps(other) for other in existing)), None)
if not subnet:
    raise RuntimeError('no unused synthetic Docker subnet')
archive = subprocess.run(['gh', 'api', f'repos/piyawatv-cloud/formula-runtime/tarball/{REVISION}'], capture_output=True, check=True).stdout
with tempfile.TemporaryDirectory(prefix='formula-approval-e2e-') as temp:
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
        members = package.getmembers()
        if any(not (item.isfile() or item.isdir()) for item in members):
            raise RuntimeError('unsupported archive entry')
        package.extractall(temp, filter='data')
        roots = {item.name.split('/')[0] for item in members if item.name}
    if len(roots) != 1:
        raise RuntimeError('ambiguous archive root')
    folder = Path(temp, roots.pop())
    if hashlib.sha256((folder / 'runtime/formula-proxy.mjs').read_bytes()).hexdigest() != PROXY_SHA:
        raise RuntimeError('unexpected runtime proxy hash')
    target = folder / 'releases/cf7ab7813cbe/index.html'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(page_bytes)
    extra = '\n'.join((ROOT / 'mobile-preview/integration' / name).read_text() for name in ('current-approval-e2e.extra.mjs', 'current-session-e2e.extra.mjs', 'current-copy-e2e.extra.mjs', 'current-row-e2e.extra.mjs', 'current-row-browser-e2e.extra.mjs', 'current-read-e2e.extra.mjs', 'current-chat-write-e2e.extra.mjs', 'current-chat-guard-e2e.extra.mjs'))
    # Resolve the added imports before registering the synthetic test suite.
    import_line = re.compile(r'^const \w+=\(?await import\([^\n]+$', re.MULTILINE)
    imports = import_line.findall(extra)
    if len(imports) != 8:
        raise RuntimeError('unexpected synthetic test imports')
    extra = import_line.sub('', extra)
    async_page_read = "readFileSyncForCopy.bytes=await readFile(new URL('releases/cf7ab7813cbe/index.html',root),'utf8');"
    if extra.count(async_page_read) != 1:
        raise RuntimeError('unexpected synthetic page fixture')
    extra = extra.replace(async_page_read, "readFileSyncForCopy.bytes=syntheticReadFileSync(new URL('releases/cf7ab7813cbe/index.html',root),'utf8');")
    test = folder / 'tests/job-sync-e2e.test.mjs'
    source = test.read_text()
    old = "assert.equal(payload.central_user_id, 'synthetic-actor');"
    replacement = "assert.ok(['synthetic-actor','synthetic-other'].includes(payload.central_user_id));"
    if source.count(old) != 1:
        raise RuntimeError('unexpected upstream synthetic IAM fixture')
    # Modify only the temporary fake IAM fixture to admit two synthetic users.
    source = source.replace(old, replacement)
    static_import = re.compile(r'^import [^\n]+;\s*$', re.MULTILINE)
    static_imports = static_import.findall(source)
    if len(static_imports) != 11:
        raise RuntimeError('unexpected upstream imports')
    test_import = "import { before, after, beforeEach, test } from 'node:test';"
    if static_imports.count(test_import) != 1:
        raise RuntimeError('unexpected upstream test import')
    static_imports[static_imports.index(test_import)] = "import { before, after, beforeEach, test as registerSyntheticTest } from 'node:test';"
    source = static_import.sub('', source)
    # Explicit suite scope ensures the setup and cleanup hooks belong to all
    # appended tests even when the name filter skips the original tests.
    suite = 'synthetic chatguard e2e: suite' if sys.argv[1:] == ['--chat-guard-only'] else 'synthetic approval e2e: suite'
    selected = 'synthetic chatguard e2e:' if sys.argv[1:] == ['--chat-guard-only'] else 'synthetic (approval|session|copy|row|read|chat|chatguard) e2e:'
    test_filter = 'const syntheticPattern = new RegExp(' + json.dumps(selected) + ');\nconst test = (name, ...args) => syntheticPattern.test(name) ? registerSyntheticTest(name, ...args) : undefined;\n'
    test.write_text('\n'.join(static_imports) + "\nimport { describe } from 'node:test';\nimport { readFileSync as syntheticReadFileSync } from 'node:fs';\n" + '\n'.join(imports) + '\ndescribe(' + json.dumps(suite) + ', () => {\n' + test_filter + source + '\n' + extra + '\n});\n')
    env = {'PATH': os.environ['PATH'], 'LC_ALL': 'C', 'LANG': 'C', 'FORMULA_TEST_NETWORK_SUBNET': subnet, 'FORMULA_MOBILE_CLIENT_URL': (ROOT / 'mobile-preview/integration/runtime-job-save.js').as_uri(), 'FORMULA_BROWSER_TEST_REQUIRED': '1', 'FORMULA_LEGACY_PAGE': str(target)}
    if os.environ.get('FORMULA_BROWSER_TEST_CHROME'):
        env['FORMULA_BROWSER_TEST_CHROME'] = os.environ['FORMULA_BROWSER_TEST_CHROME']
    for name, filename in {'FORMULA_ROW_ADAPTER_URL':'legacy-row-adapter.cjs', 'FORMULA_ROW_CALCULATOR_URL':'legacy-calculator-fixture.cjs', 'FORMULA_ROW_RENDERER_URL':'legacy-render-fixture.cjs', 'FORMULA_ROW_BRIEF_URL':'brief-gateway-fixture.cjs'}.items():
        env[name] = (ROOT / 'mobile-preview/integration' / filename).as_uri()
    env['FORMULA_MOBILE_PAGE_URL'] = (ROOT / 'mobile-preview/index.html').as_uri()
    env['FORMULA_CHAT_READ_URL'] = (ROOT / 'mobile-preview/integration/runtime-chat-read.cjs').as_uri()
    env['FORMULA_CHAT_COMPARE_URL'] = (ROOT / 'mobile-preview/integration/chat-history-compare.cjs').as_uri()
    env['FORMULA_CHAT_GUARD_SQL_URL'] = (ROOT / 'mobile-preview/simulation/chat-id-guard.sql').as_uri()
    if sys.argv[1:] not in ([], ['--chat-guard-only']):
        raise RuntimeError('unsupported test option')
    pattern = 'synthetic chatguard e2e:' if sys.argv[1:] else 'synthetic (approval|session|copy|row|read|chat|chatguard) e2e:'
    with (Path(temp) / 'test-stdout.log').open('w+') as stdout, (Path(temp) / 'test-stderr.log').open('w+') as stderr:
        result = subprocess.run(['node', '--test', '--test-name-pattern', pattern, str(test)],
                                cwd=folder, env=env, text=True, stdout=stdout, stderr=stderr)
        stdout.seek(0)
        stderr.seek(0)
        lines = stdout.read().splitlines()
        error_output = stderr.read()
    print('Synthetic approval/session/copy gateway + real PostgreSQL test, exit:', result.returncode)
    for line in lines:
        if line.lstrip().startswith(('# tests ', '# pass ', '# fail ', '# skipped ', '# cancelled ', 'not ok', 'ok ')):
            print(line)
    if result.returncode:
        index = next((i for i, line in enumerate(lines) if line.lstrip().startswith('not ok')), 0)
        for line in lines[max(0,index-15):index+30]:
            print(line.replace(temp, '<temporary>'))
        if error_output:
            print(error_output[-1200:].replace(temp, '<temporary>'))
    sys.exit(result.returncode)
