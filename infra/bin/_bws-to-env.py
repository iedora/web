#!/usr/bin/env python3
"""Read `bws secret list -o json` from stdin, emit shell-sourceable `export
KEY='value'` lines. Used by `bin/with-secrets` to bypass the macOS bash 3.2
multi-line-eval bug (see comment in with-secrets)."""
import json
import shlex
import sys

for secret in json.load(sys.stdin):
    # shlex.quote produces POSIX-safe single-quoted output that handles
    # newlines, double-quotes, backslashes — everything that breaks bash
    # 3.2's eval when sourced from a tempfile.
    print(f"export {secret['key']}={shlex.quote(secret['value'])}")
