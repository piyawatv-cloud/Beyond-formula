#!/usr/bin/env python3
"""Offline, one-job recovery preparation. No database/network/credential access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys


class PreparationError(ValueError):
    pass


def fail(code):
    raise PreparationError(code)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def read_json(path):
    try:
        raw = Path(path).read_bytes()
        return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique_object,
                          parse_constant=lambda _: fail('INVALID_JSON_CONSTANT')), hashlib.sha256(raw).hexdigest()
    except PreparationError:
        raise
    except (OSError, ValueError, UnicodeError):
        fail('INPUT_UNREADABLE_OR_INVALID_JSON')


def choose(values, key, job):
    if not isinstance(values, list):
        fail('INPUT_MUST_BE_ARRAY')
    matches = [v for v in values if isinstance(v, dict) and v.get(key) == job]
    if len(matches) != 1:
        fail('TARGET_NOT_UNIQUE')
    return matches[0]


def prepare(args):
    job = args.job_id
    if not re.fullmatch(r'[A-Z]+[0-9]{5}', job):
        fail('INVALID_JOB_ID')
    records, record_hash = read_json(args.records)
    chats, chat_hash = read_json(args.chats)
    record, chat = choose(records, 'id', job), choose(chats, 'jobId', job)
    if not isinstance(record.get('rows'), list) or not any(
        isinstance(record.get(k), str) and record[k].strip() for k in ('customer', 'brand')
    ):
        fail('INVALID_RECORD')
    creator = record.get('createdBy')
    if not isinstance(creator, str) or not creator.strip() or creator != chat.get('createdBy'):
        fail('CREATOR_MISMATCH')
    messages = chat.get('messages')
    approvals = chat.get('approvals')
    if not isinstance(messages, list) or not isinstance(approvals, dict) or not isinstance(chat.get('parts'), list):
        fail('INVALID_CHAT')
    unique = {}
    for message in messages:
        if not isinstance(message, dict) or not isinstance(message.get('uid'), str) or not message['uid'].strip():
            fail('MESSAGE_UID_REQUIRED')
        if type(message.get('ts')) is not int or not 0 < message['ts'] <= 9223372036854775807:
            fail('INVALID_MESSAGE_TIMESTAMP')
        if message['uid'] in unique and unique[message['uid']] != message:
            fail('DUPLICATE_MESSAGE_CONFLICT')
        unique[message['uid']] = message
    if any(k not in ('pd', 'ra', 'rd', 'sales') or not isinstance(v, dict) for k, v in approvals.items()):
        fail('INVALID_APPROVALS')
    history = []
    extra_type = 'NOT_PROVIDED'
    hashes = {'records': record_hash, 'chats': chat_hash}
    if args.extra:
        extra, hashes['extra'] = read_json(args.extra)
        if not isinstance(extra, dict) or not all(isinstance(v, list) for v in extra.values()):
            fail('EXTRA_NOT_VERSION_HISTORY')
        if not all(isinstance(v, dict) and isinstance(v.get('data'), dict) and 'ts' in v and 'why' in v
                   for versions in extra.values() for v in versions):
            fail('EXTRA_NOT_VERSION_HISTORY')
        extra_type = 'VERSION_HISTORY'
        history = extra.get(job, [])
        if any(v['data'].get('id') != job for v in history):
            fail('HISTORY_JOB_MISMATCH')
    payload = {'version': 1, 'record': record, 'chat': chat, 'messages': list(unique.values())}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if '\\u0000' in encoded:
        fail('UNSUPPORTED_JSONB_NULL_CHARACTER')
    encoded.encode('utf-8')
    # A generated delimiter not present in the data makes arbitrary JSON inert SQL data.
    i = 0
    while True:
        tag = '$job_payload_' + hashlib.sha256((encoded + str(i)).encode()).hexdigest()[:24] + '$'
        if tag not in encoded:
            break
        i += 1
    template = Path(__file__).with_name('job-recovery.sql.in').read_text()
    if template.count('__PAYLOAD__') != 1:
        fail('INVALID_SQL_TEMPLATE')
    body_tag = tag.replace('job_payload_', 'job_body_')
    while body_tag in encoded:
        body_tag = body_tag[:-1] + 'x$'
    sql = template.replace('$job_restore$', body_tag).replace('__PAYLOAD__', tag + encoded + tag + '::jsonb')
    output = Path(args.output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    metadata = {'status': 'PREPARED_NOT_APPLIED', 'jobId': job,
                'formulaRowCount': len(record['rows']), 'messageCount': len(unique),
                'approvalCount': len(approvals), 'participantCount': len(chat['parts']),
                'extraFileType': extra_type, 'historyVersions': len(history), 'inputSha256': hashes}
    files = {'record.json': json.dumps(record, ensure_ascii=False, indent=2) + '\n',
             'chat.json': json.dumps(chat, ensure_ascii=False, indent=2) + '\n',
             'history.json': json.dumps(history, ensure_ascii=False, indent=2) + '\n',
             'restore.sql': sql,
             'SUMMARY.json': json.dumps(metadata, ensure_ascii=False, indent=2) + '\n'}
    manifest = []
    for name, content in files.items():
        raw = content.encode()
        with (output / name).open('xb') as file:
            os.chmod(output / name, 0o600)
            file.write(raw)
        manifest.append(hashlib.sha256(raw).hexdigest() + '  ' + name)
    with (output / 'MANIFEST.sha256').open('x') as file:
        os.chmod(output / 'MANIFEST.sha256', 0o600)
        file.write('\n'.join(manifest) + '\n')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('records', 'chats', 'job-id', 'output'):
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--extra')
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), ensure_ascii=False))
    except (ValueError, OSError) as error:
        print(json.dumps({'status': 'PREPARATION_FAILED', 'reason': str(error) if isinstance(error, PreparationError) else 'OUTPUT_OR_ENCODING_UNAVAILABLE'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
