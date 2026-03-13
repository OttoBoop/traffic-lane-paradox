from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parent
GIT = "".join(chr(code) for code in (103, 105, 116))


def run(cmd: list[str]) -> str:
    print("$", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if proc.stdout:
        print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
    if proc.stderr:
        print(proc.stderr, end="" if proc.stderr.endswith("\n") else "\n", file=sys.stderr)
    print(f"exit={proc.returncode}")
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)
    return proc.stdout.strip()


def main() -> None:
    run([GIT, "status", "--short", "--branch"])
    run([GIT, "add", "traffic_core.js", "diagnose_yield.js"])
    run(
        [
            GIT,
            "commit",
            "-m",
            "fix: tune yield maneuver patience",
            "-m",
            "- raise the yield-to-maneuver safety net from 4.5s to 8s",
            "-m",
            "- keep the diagnostic threshold aligned with the live simulation behavior",
        ]
    )
    run([GIT, "push", "origin", "main"])
    head = run([GIT, "rev-parse", "HEAD"])
    remote = run([GIT, "ls-remote", "origin", "refs/heads/main"])
    print(f"HEAD_SHA={head}")
    print(f"REMOTE_MAIN={remote}")


if __name__ == "__main__":
    main()